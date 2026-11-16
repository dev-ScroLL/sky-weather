const $ = (id) => document.getElementById(id);
const home = {name:'İstanbul', country:'Türkiye', country_code:'TR', latitude:41.0082, longitude:28.9784};
let selected = home;
let weather = null;
let unit = 'C';
let forecastRequest;
let searchRequest;

let notice = {};
let weatherFailed = false;
function status(key = '', values = {}) {
  notice = {key, values};
  $('notice').textContent = key ? t(key, values) : '';
  $('notice').hidden = !key;
}

function displayCity(place) {
  if (place === home) return t('homeCity');
  return place.deviceLocation ? t('myLocation') : place.name;
}

function displayCountry(place) {
  return place.country_code ? new Intl.DisplayNames(locale, {type:'region'}).of(place.country_code) : place.country ?? '';
}

function showWeatherPlaceholder() {
  $('city').textContent = displayCity(home);
  $('country').textContent = displayCountry(home);
  $('date').textContent = t(weatherFailed ? 'noDate' : 'loadingDate');
  $('condition').textContent = t(weatherFailed ? 'unavailable' : 'loading');
}

function condition(code, day = true) {
  if (code === 0) return day ? ['☀️',t('clear')] : ['🌙',t('clear')];
  if (code === 1 || code === 2) return day ? ['🌤️',t('partly')] : ['☁️',t('partly')];
  if (code === 3) return ['☁️',t('cloudy')];
  if ([45,48].includes(code)) return ['',t('fog'),'fog-icon'];
  if ([51,53,55,56,57].includes(code)) return ['🌦️',t('drizzle')];
  if ([61,63,65,66,67,80,81,82].includes(code)) return ['🌧️',t('rainy')];
  if ([71,73,75,77,85,86].includes(code)) return ['🌨️',t('snow')];
  if ([95,96,99].includes(code)) return ['⛈️',t('thunder')];
  return ['—',t('noData')];
}

function temp(value) {
  return Number.isFinite(value) ? localNumber(unit === 'F' ? value * 9 / 5 + 32 : value, {maximumFractionDigits:0}) + '°' : '—';
}

function measure(value, options) {
  return Number.isFinite(value) ? localNumber(value, {maximumFractionDigits:0, ...options}) : '—';
}

function span(value, className = '') {
  const item = document.createElement('span');
  item.textContent = value;
  item.className = className;
  return item;
}

function render() {
  const {current, hourly, daily} = weather;
  const start = Math.max(0, hourly.time.findIndex((stamp) => stamp === current.time.slice(0, 13) + ':00'));
  const [icon, description, iconClass = ''] = condition(current.weather_code, current.is_day);
  $('city').textContent = displayCity(selected);
  $('country').textContent = displayCountry(selected);
  $('date').textContent = new Intl.DateTimeFormat(locale, {dateStyle:'full'}).format(new Date(current.time.slice(0,10) + 'T12:00'));
  $('temp').textContent = temp(current.temperature_2m);
  $('symbol').textContent = icon;
  $('symbol').className = iconClass;
  $('condition').textContent = description;
  $('range').textContent = '↑ ' + temp(daily.temperature_2m_max[0]) + '   ↓ ' + temp(daily.temperature_2m_min[0]);
  $('feels').textContent = temp(current.apparent_temperature);
  $('wind').textContent = measure(current.wind_speed_10m, {style:'unit', unit:'kilometer-per-hour'});
  $('humidity').textContent = measure(Number.isFinite(current.relative_humidity_2m) ? current.relative_humidity_2m / 100 : NaN, {style:'percent'});
  $('rain').textContent = measure(Number.isFinite(daily.precipitation_probability_max[0]) ? daily.precipitation_probability_max[0] / 100 : NaN, {style:'percent'});

  $('hours').replaceChildren(...hourly.time.slice(start, start + 24).map((stamp, offset) => {
    const i = start + offset;
    const hour = document.createElement('div');
    hour.className = 'hour';
    const time = document.createElement('time');
    time.dateTime = stamp;
    time.textContent = offset === 0 ? t('now') : stamp.slice(11);
    const [hourIcon, label, iconClass = ''] = condition(hourly.weather_code[i], hourly.is_day[i]);
    const picture = span(hourIcon, ('icon ' + iconClass).trim());
    picture.setAttribute('role', 'img');
    picture.setAttribute('aria-label', label);
    const value = document.createElement('strong');
    value.textContent = temp(hourly.temperature_2m[i]);
    hour.append(time, picture, value);
    return hour;
  }));

  const low = Math.min(...daily.temperature_2m_min.filter(Number.isFinite));
  const high = Math.max(...daily.temperature_2m_max.filter(Number.isFinite));
  const spread = Math.max(1, high - low);
  const weekday = new Intl.DateTimeFormat(locale, {weekday:'long'});
  $('days').replaceChildren(...daily.time.map((stamp, i) => {
    const row = document.createElement('div');
    row.className = 'day';
    const min = daily.temperature_2m_min[i];
    const max = daily.temperature_2m_max[i];
    const [dayIcon, label, iconClass = ''] = condition(daily.weather_code[i]);
    const picture = span(dayIcon, ('icon ' + iconClass).trim());
    picture.setAttribute('role', 'img');
    picture.setAttribute('aria-label', label);
    picture.title = label;
    const track = span('', 'track');
    track.setAttribute('aria-hidden','true');
    if (Number.isFinite(min) && Number.isFinite(max)) {
      const bar = document.createElement('i');
      bar.style.left = 100 * (min - low) / spread + '%';
      bar.style.width = 100 * (max - min) / spread + '%';
      track.append(bar);
    }
    row.append(span(i ? weekday.format(new Date(stamp + 'T12:00')) : t('today')), picture, span(temp(min),'min'), track, span(temp(max),'max'));
    return row;
  }));
}

async function getJSON(host, params, signal) {
  const response = await fetch(host + '?' + new URLSearchParams(params), {signal:AbortSignal.any([signal, AbortSignal.timeout(14000)])});
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

async function loadWeather(place) {
  forecastRequest?.abort();
  const request = new AbortController();
  forecastRequest = request;
  status('forecast', {city:displayCity(place)});
  try {
    const data = await getJSON('https://api.open-meteo.com/v1/forecast', {
      latitude:place.latitude, longitude:place.longitude, timezone:'auto', forecast_days:7,
      current:'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
      hourly:'temperature_2m,weather_code,is_day',
      daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    }, request.signal);
    if (request !== forecastRequest) return;
    selected = place;
    weather = data;
    render();
    loadCityPhoto(place);
    $('hours').scrollLeft = 0;
    status();
  } catch {
    if (request.signal.aborted) return;
    status('forecastError', {city:displayCity(place)});
    if (!weather) {
      weatherFailed = true;
      showWeatherPlaceholder();
    }
  }
}

function rankSearchResults(results, name) {
  const query = photoName(name);
  const exactSettlements = [];
  const otherPlaces = [];
  for (const place of results) {
    const exact = place.feature_code?.startsWith('PPL') && photoName(place.name) === query;
    (exact ? exactSettlements : otherPlaces).push(place);
  }
  return [...exactSettlements, ...otherPlaces];
}

function renderSearchResults(results, name) {
  const buttons = rankSearchResults(results, name).map((place) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = [...new Set([place.name, place.admin1, displayCountry(place)].filter(Boolean))].join(', ');
    item.addEventListener('click', () => {
      $('query').value = place.name;
      $('results').hidden = true;
      $('query').focus();
      loadWeather(place);
    });
    return item;
  });

  const list = $('results');
  list.replaceChildren(...buttons.slice(0, 3));
  if (buttons.length > 3) {
    const more = document.createElement('details');
    const label = document.createElement('summary');
    label.textContent = t('moreResults');
    more.append(label, ...buttons.slice(3));
    list.append(more);
  }
}

$('search').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('query').value.trim();
  if (name.length < 2) return;
  searchRequest?.abort();
  const request = new AbortController();
  searchRequest = request;
  $('results').hidden = true;
  status('searching');
  try {
    const {results = []} = await getJSON('https://geocoding-api.open-meteo.com/v1/search', {name, count:6, language:locale, format:'json'}, request.signal);
    if (request !== searchRequest) return;
    if (!results.length) {
      status('noCities');
      return;
    }
    renderSearchResults(results, name);
    $('results').hidden = false;
    $('results').firstElementChild.focus();
    status();
  } catch {
    if (!request.signal.aborted) status('searchError');
  }
});

document.addEventListener('click', (event) => {
  if (!$('search').contains(event.target)) $('results').hidden = true;
});
$('search').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    $('results').hidden = true;
    $('query').focus();
  }
});
document.querySelectorAll('[data-unit]').forEach((button) => button.addEventListener('click', () => {
  unit = button.dataset.unit;
  document.querySelectorAll('[data-unit]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  if (weather) render();
}));
$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) {
    status('noGeo');
    return;
  }
  $('locate').disabled = true;
  status('geolocating');
  navigator.geolocation.getCurrentPosition(({coords}) => {
    $('locate').disabled = false;
    loadWeather({name:'', deviceLocation:true, latitude:coords.latitude, longitude:coords.longitude});
  }, () => {
    $('locate').disabled = false;
    status('geoError');
  }, {timeout:10000, maximumAge:300000});
});
$('language').addEventListener('change', (event) => {
  locale = event.target.value;
  try { localStorage.setItem('sky-language', locale); } catch {}
  searchRequest?.abort();
  $('results').hidden = true;
  applyLanguage();
  status(notice.key === 'searching' ? '' : notice.key, notice.values);
  if (weather) render();
  else showWeatherPlaceholder();
});
applyLanguage();
showWeatherPlaceholder();
loadWeather(home);
