/* app.js
   Replace 'YOUR_OWM_API_KEY' with your OpenWeatherMap API key
   Uses OpenWeatherMap:
     - Geocoding API for autocomplete: /geo/1.0/direct?q=...&limit=5&appid=KEY
     - Current weather: /data/2.5/weather
     - Forecast: /data/2.5/forecast
*/
const OWM_KEY = '4bcefca3b49816724286402234d94e7c';
const TABS_LIST = '#tabs-list';
const TABS_CONTAINER = '#tabs';

// ----------------- Utilities -----------------
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}
function capitalizeWords(s){
  return String(s).split(' ').filter(Boolean).map(w => w[0].toUpperCase()+w.slice(1)).join(' ');
}
function escapeHtml(unsafe) {
  if (!unsafe && unsafe !== 0) return '';
  return String(unsafe)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}
function debounce(fn, wait){
  let t;
  return function(...args){
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

// ----------------- DOM init -----------------
$(function() {
  // Tabs
  $("#tabs").tabs({
    activate: function(event, ui) {
      ui.newPanel.find(".accordion").accordion("refresh");
    }
  });

  // Load saved cities or default ones
  const defaultCities = ['Pune','Mumbai','New York'];
  let saved = loadCities();
  if (!saved || saved.length === 0) {
    saved = defaultCities;
    saveCities(saved);
  }
  saved.forEach(city => addCityTab(city, false));

  // Set up autocomplete (live OWM geocoding)
  $("#city-input").autocomplete({
    minLength: 2,
    delay: 300,
    source: function(request, response) {
      // debounce inside not necessary because jQuery UI already has delay, but we add safety
      fetchGeo(request.term).then(items => {
        response(items.map(i => ({
          label: i.display_name,
          value: i.display_name,
          raw: i
        })));
      }).catch(err => {
        console.error('Autocomplete error', err);
        response([]);
      });
    },
    select: function(event, ui) {
      // when user picks suggestion, add city tab
      const raw = ui.item.raw;
      // Create a friendly display: City, State (if any), Country
      const parts = [raw.name, raw.state, raw.country].filter(Boolean);
      const display = parts.join(', ');
      addCityTab(display, true);
      // clear input
      $(this).val('');
      return false;
    }
  });

  // Add click handlers
  $('#add-city').on('click', () => {
    const val = $('#city-input').val().trim();
    if (val) {
      addCityTab(val, true);
      $('#city-input').val('');
    }
  });

  $('#city-input').on('keypress', (e) => {
    if (e.which === 13) $('#add-city').click();
  });

  $('#clear-all').on('click', () => {
    if (confirm('Clear all saved cities?')) {
      localStorage.removeItem('weather_cities');
      $('#tabs-list').empty();
      $('#tabs').find('.tab-panel').remove();
      $("#tabs").tabs('refresh');
    }
  });

  // Start clock
  startClock('Asia/Kolkata');
});

// ----------------- Storage helpers -----------------
function saveCities(arr) {
  localStorage.setItem('weather_cities', JSON.stringify(arr));
}
function loadCities() {
  const raw = localStorage.getItem('weather_cities');
  return raw ? JSON.parse(raw) : null;
}

// ----------------- Tab creation and removal -----------------
function addCityTab(cityName, save = true) {
  cityName = capitalizeWords(cityName);
  const safeLabel = escapeHtml(cityName);
  const id = `tab-${slug(cityName)}-${Date.now()}`;
  // create tab header
  const li = $(`<li><a href="#${id}">${safeLabel}</a> <span class="remove" title="Remove">✕</span></li>`);
  $(TABS_LIST).append(li);
  // create tab panel
  const panel = $(`
    <div id="${id}" class="tab-panel">
      <div class="status">Loading weather for <strong>${safeLabel}</strong>…</div>
      <div class="accordion">
        <h3>Current Weather</h3><div class="current-panel"></div>
        <h3>5-day Forecast</h3><div class="forecast-panel"></div>
        <h3>Extra Details</h3><div class="extra-panel"></div>
      </div>
    </div>
  `);
  $('#tabs').append(panel);
  $("#tabs").tabs("refresh");

  // initialize accordion for this panel
  panel.find(".accordion").accordion({
    heightStyle: "content",
    collapsible: true
  });

  // fetch and render weather
  fetchAndRender(cityName, panel);

  // remove city handler
  li.find('.remove').on('click', function() {
    if (!confirm(`Remove ${cityName} from dashboard?`)) return;
    const idx = $(this).closest('li').index();
    $(this).closest('li').remove();
    panel.remove();
    $("#tabs").tabs("refresh");
    // update local storage
    let arr = loadCities() || [];
    arr = arr.filter(c => slug(c) !== slug(cityName));
    saveCities(arr);
  });

  // Save to localStorage
  if (save) {
    let arr = loadCities() || [];
    if (!arr.some(c => slug(c) === slug(cityName))) {
      arr.push(cityName);
      saveCities(arr);
    }
    // switch to new tab
    const lastIndex = $('#tabs-list li').length - 1;
    $("#tabs").tabs("option", "active", lastIndex);
  }
}

// ----------------- Fetch & Render -----------------
async function fetchAndRender(city, panel) {
  const status = panel.find('.status').text(`Loading weather for ${city}…`);
  try {
    const current = await fetchCurrentWeather(city);
    const forecast = await fetchForecast(city);
    renderCurrent(current, panel.find('.current-panel'));
    renderForecast(forecast, panel.find('.forecast-panel'));
    renderExtra(current, panel.find('.extra-panel'));

    // 🌤️ Dynamic background update here
    const weatherMain = current.weather[0].main.toLowerCase();
    let bgImage;

    if (weatherMain.includes("cloud")) bgImage = "url('images/cloudy.jpg')";
    else if (weatherMain.includes("rain")) bgImage = "url('images/rainy.jpg')";
    else if (weatherMain.includes("clear")) bgImage = "url('images/sunny.jpg')";
    else if (weatherMain.includes("snow")) bgImage = "url('images/snowy.jpg')";
    else if (weatherMain.includes("mist") || weatherMain.includes("fog")) bgImage = "url('images/foggy.jpg')";
    else bgImage = "url('images/default.jpg')";

    $("#background").css("background-image", bgImage);

    panel.find('.status').text(`Weather updated: ${new Date().toLocaleString()}`);
    panel.find(".accordion").accordion("refresh");
  } catch (err) {
    console.error(err);
    panel.find('.status').html(`<span style="color:crimson">Error loading data for ${escapeHtml(city)} — ${escapeHtml(err.message || err)}</span>`);
  }
}


// Helper: fetch JSON with nicer errors
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${res.statusText} — ${t}`);
  }
  return await res.json();
}

// Geocoding (autocomplete) - OpenWeatherMap direct geocoding
async function fetchGeo(query) {
  if (!OWM_KEY || OWM_KEY === 'YOUR_OWM_API_KEY') {
    // Fallback list (if key not set)
    const fallback = ["Pune, India","Mumbai, India","Delhi, India","London, UK","Paris, France","New York, US"];
    return fallback.filter(x => x.toLowerCase().includes(query.toLowerCase())).map(s => {
      const parts = s.split(',');
      return {display_name: s, name: parts[0].trim(), state: parts[1] ? parts[1].trim() : '', country: parts[1] ? parts[1].trim() : ''};
    });
  }
  const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=6&appid=${OWM_KEY}`;
  const data = await fetchJSON(url);
  // map to lighter objects
  return data.map(d => ({
    display_name: [d.name, d.state, d.country].filter(Boolean).join(', '),
    name: d.name,
    state: d.state,
    country: d.country,
    raw: d
  }));
}

// Current weather
async function fetchCurrentWeather(city) {
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${OWM_KEY}&units=metric`;
  return await fetchJSON(url);
}

// Forecast
async function fetchForecast(city) {
  const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&appid=${OWM_KEY}&units=metric`;
  return await fetchJSON(url);
}

// ----------------- Render helpers -----------------
function renderCurrent(data, container) {
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
          </div>
        </div>
      </div>
    </div>
  `;
  container.html(html);
}

function renderForecast(forecastData, container) {
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
  container.html(`<div class="forecast-grid">${cards}</div>`);
}

function renderExtra(currentData, container) {
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
  container.html(html);
}

// ----------------- Clock -----------------
function startClock(timeZone = undefined) {
  const el = document.getElementById('clock');
  if (!el) return;
  function update() {
    const now = new Date();
    const opts = {
      weekday:'long',
      year:'numeric',
      month:'short',
      day:'numeric',
      hour:'numeric',
      minute:'2-digit',
      second:'2-digit',
      hour12:true
    };
    try {
      // if timeZone provided (e.g., Asia/Kolkata), use it
      const txt = new Intl.DateTimeFormat(undefined, {...opts, timeZone}).format(now);
      el.textContent = txt;
    } catch(e) {
      // fallback
      el.textContent = now.toLocaleString();
    }
  }
  update();
  setInterval(update, 1000);
}

// ----------------- Live Location -----------------
$('#getLocationBtn').on('click', () => {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(fetchWeatherByCoords, handleLocationError);
  } else {
    alert("Geolocation is not supported by this browser.");
  }
});

async function fetchWeatherByCoords(position) {
  const lat = position.coords.latitude;
  const lon = position.coords.longitude;

  try {
    const urlCurrent = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OWM_KEY}&units=metric`;
    const dataCurrent = await fetchJSON(urlCurrent);
    
    const cityName = dataCurrent.name; // City name from API
    addCityTab(cityName, true); // Reuse your existing tab function

  } catch (err) {
    console.error(err);
    alert('Error fetching weather for your location.');
  }
}

function handleLocationError(error) {
  switch(error.code) {
    case error.PERMISSION_DENIED:
      alert("User denied the request for Geolocation.");
      break;
    case error.POSITION_UNAVAILABLE:
      alert("Location information is unavailable.");
      break;
    case error.TIMEOUT:
      alert("The request to get user location timed out.");
      break;
    default:
      alert("An unknown error occurred.");
      break;
  }
}



