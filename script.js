const apiKey = "YOUR_OPENWEATHERMAP_KEY"; // Replace with your API key

$(function () {
  $("#tabs").tabs();

  // Initialize city autocomplete
  const cities = ["Mumbai", "Delhi", "London", "Tokyo", "New York", "Paris", "Pune"];
  $("#cityInput").autocomplete({ source: cities });

  $("#searchBtn").click(() => {
    const city = $("#cityInput").val();
    if (city) getWeatherByCity(city);
  });

  getUserLocation();
  updateDateTime();
  setInterval(updateDateTime, 1000);
});

function updateDateTime() {
  $("#datetime").text(new Date().toLocaleString());
}

function getUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        getWeatherByCoordinates(latitude, longitude);
      },
      (error) => {
        alert("Please allow location access for live weather.");
        console.error(error);
      }
    );
  } else {
    alert("Geolocation is not supported.");
  }
}

function getWeatherByCoordinates(lat, lon) {
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
  fetch(url)
    .then((res) => res.json())
    .then((data) => {
      displayCurrentWeather(data);
      setBackground(data.weather[0].main.toLowerCase());
      getForecast(data.name);
      getAQI(lat, lon);
    });
}

function getWeatherByCity(city) {
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric`;
  fetch(url)
    .then((res) => res.json())
    .then((data) => {
      displayCurrentWeather(data);
      setBackground(data.weather[0].main.toLowerCase());
      getForecast(city);
      getAQI(data.coord.lat, data.coord.lon);
    });
}

function displayCurrentWeather(data) {
  const weatherHTML = `
    <h2>${data.name}</h2>
    <p>${data.weather[0].description}</p>
    <p>🌡️ Temp: ${data.main.temp} °C</p>
    <p>💧 Humidity: ${data.main.humidity}%</p>
    <p>💨 Wind: ${data.wind.speed} m/s</p>
  `;
  $("#current-weather").html(weatherHTML);

  if (data.weather[0].main.toLowerCase().includes("rain")) {
    showNotification("🌧️ Rain Alert!", "It might rain soon. Stay dry!");
  }
}

function getForecast(city) {
  const url = `https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${apiKey}&units=metric`;
  fetch(url)
    .then((res) => res.json())
    .then((data) => {
      const labels = [];
      const temps = [];
      for (let i = 0; i < data.list.length; i += 8) {
        labels.push(new Date(data.list[i].dt_txt).toLocaleDateString());
        temps.push(data.list[i].main.temp);
      }

      new Chart(document.getElementById("forecastChart"), {
        type: "line",
        data: {
          labels,
          datasets: [{
            label: "5-Day Temp (°C)",
            data: temps,
            borderColor: "#000000",
            borderWidth: 2,
            fill: false
          }]
        },
        options: { scales: { y: { beginAtZero: false } } }
      });
    });
}

function getAQI(lat, lon) {
  const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;
  fetch(url)
    .then((res) => res.json())
    .then((data) => {
      const aqi = data.list[0].main.aqi;
      const levels = ["Good", "Fair", "Moderate", "Poor", "Very Poor"];
      $("#air-quality").html(`<h3>AQI: ${aqi} (${levels[aqi - 1]})</h3>`);
    });
}

function setBackground(weather) {
  const body = document.body;
  let bg = "images/default.jpg";

  if (weather.includes("clear")) bg = "images/clear.jpg";
  else if (weather.includes("cloud")) bg = "images/cloudy.jpg";
  else if (weather.includes("rain")) bg = "images/rain.jpg";
  else if (weather.includes("snow")) bg = "images/snow.jpg";
  else if (weather.includes("thunder")) bg = "images/thunder.jpg";

  body.style.backgroundImage = `url(${bg})`;
}

function showNotification(title, message) {
  if (Notification.permission === "granted") {
    new Notification(title, { body: message });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") new Notification(title, { body: message });
    });
  }
}
