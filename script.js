/* script.js
   Enhanced Weather Dashboard
   Replace YOUR_OWM_KEY_HERE with your OpenWeatherMap API Key.
*/
const OWM_KEY = '4bcefca3b49816724286402234d94e7c'; // <-- REPLACE THIS
const TABS_LIST = '#tabs-list';
const TABS_CONTAINER = '#tabs';

function slug(s){ return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function capitalizeWords(s){ return String(s).split(' ').filter(Boolean).map(w => w[0].toUpperCase()+w.slice(1)).join(' '); }
function escapeHtml(unsafe){ if (!unsafe && unsafe !== 0) return ''; return String(unsafe).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }

$(function(){
  // Initialize tabs & accordion
  $("#tabs").tabs({ activate: (e,ui)=> ui.newPanel.find('.accordion').accordion("refresh") });

  // Load cities
  const defaultCities = ['Pune','Mumbai','New York'];
  let saved = loadCities();
  if (!saved || saved.length === 0) { saved = defaultCities; saveCities(saved); }
  saved.forEach(city => addCityTab(city, false));

  // Autocomplete (live geocoding or fallback)
  $("#city-input").autocomplete({
    minLength: 2, delay: 300,
    source: function(request, response) {
      fetchGeo(request.term).then(items => {
        response(items.map(i => ({ label: i.display_name, value: i.display_name, raw: i })));
      }).catch(err => response([]));
    },
    select: function(event, ui) {
      const raw = ui.item.raw;
      const parts = [raw.name, raw.state, raw.country].filter(Boolean);
      const display = parts.join(', ');
      addCityTab(display, true);
      $(this).val(''); return false;
    }
  });

  // Buttons
  $('#add-city').on('click', () => {
    const val = $('#city-input').val().trim();
    if (val) { addCityTab(val, true); $('#city-input').val(''); }
  });
  $('#city-input').on('keypress', e => { if (e.which === 13) $('#add-city').click(); });

  $('#clear-all').on('click', () => {
    if (confirm('Clear all saved cities?')) {
      localStorage.removeItem('weather_cities');
      $(TABS_LIST).empty();
      $('#tabs').find('.tab-panel').remove();
      $("#tabs").tabs('refresh');
    }
  });

  // Theme toggle
  initTheme();

  // Start clock (Asia/Kolkata)
  startClock('Asia/Kolkata');

  // Location button
  $('#getLocationBtn').on('click', () => {
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition(fetchWeatherByCoords, handleLocationError);
    else alert("Geolocation not supported by this browser.");
  });

  // Request Notification permission early (non-blocking)
  if ('Notification' in window && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch(e) {}
  }
});

/* Storage helpers */
function saveCities(arr){ localStorage.setItem('weather_cities', JSON.stringify(arr)); }
function loadCities(){ const raw = localStorage.getItem('weather_cities'); return raw ? JSON.parse(raw) : null; }

/* Add tab */
function addCityTab(cityName, save=true){
  cityName = capitalizeWords(cityName);
  const safeLabel = escapeHtml(cityName);
  const id = `tab-${slug(cityName)}-${Date.now()}`;
  const li = $(`<li><a href="#${id}">${safeLabel}</a> <span class="remove" title="Remove">✕</span></li>`);
  $(TABS_LIST).append(li);
  const panel = $(`
    <div id="${id}" class="tab-panel" role="tabpanel">
      <div class="status">Loading weather for <strong>${safeLabel}</strong>…</div>
      <div class="accordion">
        <h3>Current Weather</h3><div class="current-panel"></div>
        <h3>Forecast & Hourly</h3><div class="forecast-panel"></div>
        <h3>Extra Details</h3><div class="extra-panel"></div>
      </div>
    </div>
  `);
  $(TABS_CONTAINER).append(panel);
  $("#tabs").tabs("refresh");
  panel.find(".accordion").accordion({ heightStyle: "content", collapsible: true });

  // fetch data
  fetchAndRender(cityName, panel);

  // remove handler
  li.find('.remove').on('click', function(){
    if (!confirm(`Remove ${cityName} from dashboard?`)) return;
    const idx = $(this).closest('li').index();
    $(this).closest('li').remove();
    panel.remove();
    $("#tabs").tabs("refresh");
    let arr = loadCities() || [];
    arr = arr.filter(c => slug(c) !== slug(cityName));
    saveCities(arr);
  });

  // Save to localStorage
  if (save) {
    let arr = loadCities() || [];
    if (!arr.some(c => slug(c) === slug(cityName))) { arr.push(cityName); saveCities(arr); }
    const lastIndex = $('#tabs-list li').length - 1;
    $("#tabs").tabs("option", "active", lastIndex);
  }
}

/* Fetch & Render */
async function fetchAndRender(city, panel){
  panel.find('.status').text(`Loading weather for ${city}…`);
  try {
    const current = await fetchCurrentWeather(city);
    const forecast = await fetchForecast(city);
    renderCurrent(current, panel.find('.current-panel'));
    renderForecastAndHourly(forecast, panel.find('.forecast-panel'));
    renderExtra(current, panel.find('.extra-panel'));

    // AQI fetch using coords (if available)
    if (current.coord && typeof current.coord.lat !== 'undefined') {
      try {
        const aqi = await fetchAQI(current.coord.lat, current.coord.lon);
        renderAQI(aqi, panel.find('.extra-panel'));
      } catch(e){}
    }

    // Update background
    const weatherMain = (current.weather && current.weather[0] && current.weather[0].main || '').toLowerCase();
    updateBackground(weatherMain);

    panel.find('.status').text(`Weather updated: ${new Date().toLocaleString()}`);

    // Refresh accordion
    panel.find(".accordion").accordion("refresh");

    // Notification for heavy precipitation / thunder
    checkAndNotify(current);

  } catch (err) {
    console.error(err);
    panel.find('.status').html(`<span style="color:crimson">Error loading data for ${escapeHtml(city)} — ${escapeHtml(err.message || err)}</span>`);
  }
}

/* Helper: fetch JSON */
async function fetchJSON(url){
  const res = await fetch(url);
  if (!res.ok) { const t = await res.text(); throw new Error(`${res.status} ${res.statusText} — ${t}`); }
  return await res.json();
}

/* Geocoding (OpenWeatherMap) */
async function fetchGeo(query){
  if (!OWM_KEY || OWM_KEY === 'YOUR_OWM_KEY_HERE') {
    const fallback = ["Pune, India","Mumbai, India","Delhi, India","London, UK","Paris, France","New York, US"];
    return fallback.filter(x => x.toLowerCase().includes(query.toLowerCase())).map(s => {
      const parts = s.split(',');
      return { display_name: s, name: parts[0].trim(), state: parts[1] ? parts[1].trim() : '', country: parts[1] ? parts[1].trim() : '' };
    });
  }
  const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=6&appid=${OWM_KEY}`;
  const data = await fetchJSON(url);
  return data.map(d => ({ display_name: [d.name,d.state,d.country].filter(Boolean).join(', '), name: d.name, state: d.state, country: d.country, raw: d }));
}

/* Current weather */
async function fetchCurrentWeather(city){
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${OWM_KEY}&units=metric`;
  return await fetchJSON(url);
}

/* Forecast 5-day */
async function fetchForecast(city){
  const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&appid=${OWM_KEY}&units=metric`;
  return await fetchJSON(url);
}

/* AQI */
async function fetchAQI(lat, lon){
  if (!OWM_KEY || OWM_KEY === 'YOUR_OWM_KEY_HERE') throw new Error('API key required for AQI');
  const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${OWM_KEY}`;
  return await fetchJSON(url);
}

/* Renderers */
function renderCurrent(data, container){
  const iconUrl = `https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png`;
  const html = `
    <div class="current-weather">
      <img src="${iconUrl}" alt="${escapeHtml(data.weather[0].description)}" />
      <div class="weather-meta">
        <div style="display:flex;gap:18px;align-items:center">
          <div class="temp">${Math.round(data.main.temp)}°C</div>
          <div style="text-align:left">
            <div class="desc">${escapeHtml(data.weather[0].description)}</div>
            <div class="muted">Feels like ${Math.round(data.main.feels_like)}°C • Humidity ${data.main.humidity}%</div>
            <div class="muted">Wind ${data.wind.speed} m/s • ${data.wind.deg}°</div>
          </div>
        </div>
      </div>
    </div>
  `;
  container.html(html);
}

/* Forecast and Hourly Chart */
function renderForecastAndHourly(forecastData, container){
  // Group by day for 5-day cards
  const byDay = {};
  forecastData.list.forEach(item => {
    const date = new Date(item.dt * 1000);
    const key = date.toISOString().slice(0,10);
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(item);
  });
  const days = Object.keys(byDay).slice(0,5);
  const cards = days.map(day => {
    const items = byDay[day];
    let best = items.reduce((a,b) => {
      const da = Math.abs(new Date(a.dt*1000).getUTCHours() - 12);
      const db = Math.abs(new Date(b.dt*1000).getUTCHours() - 12);
      return da < db ? a : b;
    });
    const icon = `https://openweathermap.org/img/wn/${best.weather[0].icon}.png`;
    const dateLabel = (new Date(day)).toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric'});
    return `
      <div class="forecast-card">
        <div style="font-weight:700;margin-bottom:8px">${dateLabel}</div>
        <img src="${icon}" alt="${escapeHtml(best.weather[0].description)}" />
        <div style="font-weight:700;margin-top:6px">${Math.round(best.main.temp)}°C</div>
        <div style="font-size:13px;color:${'#6b7280'}">${escapeHtml(best.weather[0].description)}</div>
      </div>
    `;
  }).join('');

  // Hourly chart data (next 12 items => ~36 hours depending on API cadence)
  const nextPoints = forecastData.list.slice(0,12);
  const labels = nextPoints.map(p => new Date(p.dt * 1000).toLocaleTimeString(undefined, {hour:'numeric', hour12:true}));
  const temps = nextPoints.map(p => Math.round(p.main.temp));
  const icons = nextPoints.map(p => p.weather[0].icon);

  // Chart container
  const chartHtml = `
    <div style="margin-top:12px;">
      <canvas class="hourly-chart" width="600" height="180" aria-label="Hourly temperature chart"></canvas>
    </div>
  `;

  container.html(`<div class="forecast-grid">${cards}</div>${chartHtml}`);

  // Draw chart
  const canvas = container.find('.hourly-chart')[0];
  if (canvas) {
    try {
      const ctx = canvas.getContext('2d');
      // Clear previous chart if exists attached to canvas
      if (canvas._chartRef) canvas._chartRef.destroy();
      canvas._chartRef = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Temp (°C)',
            data: temps,
            tension: 0.3,
            fill: true,
            backgroundColor: function(context) {
              // gradient fill
              const g = ctx.createLinearGradient(0,0,0,180);
              g.addColorStop(0, 'rgba(16,185,129,0.12)');
              g.addColorStop(1, 'rgba(16,185,129,0.02)');
              return g;
            },
            borderColor: 'rgba(16,185,129,0.9)',
            pointRadius: 4
          }]
        },
        options: {
          plugins: { legend: { display: false } },
          scales: {
            x: { display: true, grid: { display:false } },
            y: { display: true, grid: { color: 'rgba(0,0,0,0.04)' } }
          }
        }
      });
    } catch(e){ console.warn('Chart draw failed', e); }
  }
}

/* Extra details */
function renderExtra(currentData, container){
  const sunrise = new Date(currentData.sys.sunrise * 1000).toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'});
  const sunset = new Date(currentData.sys.sunset * 1000).toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'});
  const html = `
    <div class="extra-list">
      <div>🌡️<strong>Pressure</strong><div>${currentData.main.pressure} hPa</div></div>
      <div>👁️<strong>Visibility</strong><div>${(currentData.visibility/1000).toFixed(1)} km</div></div>
      <div>💨 <strong>Wind</strong><div>${currentData.wind.speed} m/s • ${currentData.wind.deg}°</div></div>
      <div>🌅<strong>Sunrise</strong><div>${sunrise}</div></div>
      <div>🌇<strong>Sunset</strong><div>${sunset}</div></div>
    </div>
  `;
  container.prepend(html);
}

/* Render AQI (append to extra panel) */
function renderAQI(aqiResponse, container){
  if (!aqiResponse || !aqiResponse.list || !aqiResponse.list.length) return;
  const a = aqiResponse.list[0].main.aqi; // 1-5 scale (1 good, 5 very poor)
  const labels = ['Good','Fair','Moderate','Poor','Very Poor'];
  const colors = ['#10b981','#60a5fa','#f59e0b','#f97316','#ef4444'];
  const idx = Math.max(1, Math.min(5, a)); // clamp
  const html = `
    <div style="margin-top:14px;">
      <div><strong>AQI</strong> <span class="aqi-badge" style="background:${colors[idx-1]}">${a} • ${labels[idx-1]}</span></div>
      <div style="margin-top:6px;color:var(--muted);font-size:13px">${aqiHealthMessage(idx)}</div>
    </div>
  `;
  container.append(html);
}
function aqiHealthMessage(idx){
  switch(idx){
    case 1: return 'Air quality is good — ideal for outdoor activities.';
    case 2: return 'Fair air quality — sensitive individuals should take care.';
    case 3: return 'Moderate — consider limiting prolonged outdoor exertion.';
    case 4: return 'Poor — reduce prolonged or heavy exertion outdoors.';
    case 5: return 'Very poor — avoid outdoor activities; consider masks/air purifiers.';
    default: return '';
  }
}

/* Background selection */
function updateBackground(weatherMain){
  const bgEl = $("#background");
  let img = '';
  if (weatherMain.includes("cloud")) img = "url('images/cloudy.jpg')";
  else if (weatherMain.includes("rain")) img = "url('images/rainy.jpg')";
  else if (weatherMain.includes("thunder") || weatherMain.includes("storm")) img = "url('images/storm.jpg')";
  else if (weatherMain.includes("clear")) img = "url('images/sunny.jpg')";
  else if (weatherMain.includes("snow")) img = "url('images/snowy.jpg')";
  else if (weatherMain.includes("mist") || weatherMain.includes("fog")) img = "url('images/foggy.jpg')";
  else img = "url('images/default.jpg')";
  bgEl.css('background-image', img);
}

/* Notifications (very simple heuristic) */
function checkAndNotify(current){
  if (!('Notification' in window)) return;
  const w = (current.weather && current.weather[0] && current.weather[0].main || '').toLowerCase();
  const desc = (current.weather && current.weather[0] && current.weather[0].description) || '';
  if (Notification.permission !== 'granted') return;
  // alert for precipitation / thunder / snow
  if (w.includes('rain') || w.includes('drizzle')){
    sendNotification(`Rain incoming in ${current.name}`, `Conditions: ${desc}. Don't forget an umbrella ☔`);
  } else if (w.includes('thunder') || w.includes('storm')){
    sendNotification(`Storm alert for ${current.name}`, `Conditions: ${desc}. Stay safe ⚠️`);
  } else if (w.includes('snow')){
    sendNotification(`Snow expected in ${current.name}`, `Conditions: ${desc}. Dress warm ❄️`);
  }
}
function sendNotification(title, body){
  try{
    new Notification(title, { body, icon: '/favicon.ico' });
  }catch(e){ console.warn('Notification failed', e); }
}

/* Clock */
function startClock(timeZone){
  const el = document.getElementById('clock'); if (!el) return;
  function update(){
    const now = new Date();
    const opts = { weekday:'long', year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', second:'2-digit', hour12:true };
    try { el.textContent = new Intl.DateTimeFormat(undefined, {...opts, timeZone}).format(now); }
    catch(e){ el.textContent = now.toLocaleString(); }
  }
  update(); setInterval(update, 1000);
}

/* Geolocation handling */
async function fetchWeatherByCoords(position){
  const lat = position.coords.latitude;
  const lon = position.coords.longitude;
  try {
    const urlCurrent = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OWM_KEY}&units=metric`;
    const dataCurrent = await fetchJSON(urlCurrent);
    const cityName = dataCurrent.name || `${lat.toFixed(2)},${lon.toFixed(2)}`;
    addCityTab(cityName, true);
  } catch (err) { console.error(err); alert('Error fetching weather for your location.'); }
}
function handleLocationError(error){
  switch(error.code){
    case error.PERMISSION_DENIED: alert("User denied the request for Geolocation."); break;
    case error.POSITION_UNAVAILABLE: alert("Location information is unavailable."); break;
    case error.TIMEOUT: alert("The request to get user location timed out."); break;
    default: alert("An unknown error occurred."); break;
  }
}

/* Theme init & toggle */
function initTheme(){
  const root = document.documentElement;
  const saved = localStorage.getItem('weather_theme') || 'light';
  if (saved === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');

  $('#theme-toggle').on('click', () => {
    root.classList.toggle('dark');
    const now = root.classList.contains('dark') ? 'dark' : 'light';
    localStorage.setItem('weather_theme', now);
  });
}

/* Small utility: when using api key absent, many functions will fallback */
