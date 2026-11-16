const istanbulPhoto = {
  url: 'istanbul.jpg',
  source: 'https://commons.wikimedia.org/wiki/File:Modern_Istanbul_skyline_at_sunset.jpg',
  title: 'Modern Istanbul skyline at sunset',
  author: 'Ben Morlok',
  license: 'CC BY-SA 2.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0'
};
const phuketPhoto = {
  url: 'phuket.jpg',
  source: 'https://commons.wikimedia.org/wiki/File:View_of_Phuket_Town.jpg',
  title: 'View of Phuket Town',
  author: 'Christophe95',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0'
};
const photoCache = new Map();
let photoRequest;

function photoName(name) {
  return name.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('ı', 'i').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function distanceFrom(place, lat, lon) {
  const longitudeDelta = ((lon - place.longitude + 540) % 360) - 180;
  return Math.hypot(lat - place.latitude, longitudeDelta * Math.cos(place.latitude * Math.PI / 180)) * 111;
}

function catalogFiles(place) {
  const name = photoName(place.name);
  return cityPhotoCatalog.filter(([title, lat, lon]) => (
    title === name && distanceFrom(place, lat, lon) < 25
  )).map((entry) => entry[3]);
}

async function wikipediaFiles(place, language, signal) {
  const data = await getJSON('https://' + language + '.wikipedia.org/w/api.php', {
    action:'query', format:'json', formatversion:2, origin:'*', redirects:1,
    prop:'coordinates|pageimages', piprop:'name', pilicense:'free', titles:place.name
  }, signal);
  return (data.query?.pages ?? []).filter((page) => (
    acceptableFilename(page.pageimage) && page.coordinates?.some(({lat, lon}) => distanceFrom(place, lat, lon) < 25)
  )).map((page) => page.pageimage);
}

function acceptableFilename(name) {
  return typeof name === 'string' && /\.jpe?g$/i.test(name) && !/collage|montage|flag|logo|locator|coat.of.arms|\bmap\b/i.test(name);
}

function textFromMarkup(value = '') {
  const template = document.createElement('template');
  template.innerHTML = value;
  return template.content.textContent.replace(/\s+/g, ' ').trim().slice(0, 160);
}

async function commonsPhotos(files, signal) {
  const titles = [...new Set(files.filter(acceptableFilename))].slice(0, 8);
  if (!titles.length) return [];
  const data = await getJSON('https://commons.wikimedia.org/w/api.php', {
    action:'query', format:'json', formatversion:2, origin:'*', redirects:1,
    titles:titles.map((name) => 'File:' + name).join('|'), prop:'imageinfo',
    iiprop:'url|size|extmetadata', iiurlwidth:960,
    iiextmetadatafilter:'Artist|LicenseShortName|LicenseUrl'
  }, signal);
  const photos = [];
  for (const page of data.query?.pages ?? []) {
    const image = page.imageinfo?.[0];
    const license = image?.extmetadata?.LicenseShortName?.value;
    const licenseUrl = image?.extmetadata?.LicenseUrl?.value;
    if (!image?.thumburl || image.width < 640 || image.width / image.height < 1.2) continue;
    if (!/^https:\/\/(thumb|upload)\.wikimedia\.org\//.test(image.thumburl) || !image.descriptionurl.startsWith('https://commons.wikimedia.org/wiki/')) continue;
    if (!license || !/^(CC BY(-SA)? [\d.]+|CC0|Public domain)$/i.test(license)) continue;
    const author = textFromMarkup(image.extmetadata.Artist?.value);
    if (/^CC BY/i.test(license) && (!author || !licenseUrl?.startsWith('https://creativecommons.org/licenses/'))) continue;
    photos.push({
      url:image.thumburl, source:image.descriptionurl, title:page.title.slice(5).replace(/\.jpe?g$/i,''),
      author, license, licenseUrl:licenseUrl?.startsWith('https://creativecommons.org/') ? licenseUrl : image.descriptionurl
    });
  }
  return photos;
}

function clearCityPhoto() {
  $('current-weather').classList.remove('has-photo');
  $('photo-credit').hidden = true;
  $('city-photo').removeAttribute('src');
}

async function showLoadedPhoto(photo, signal) {
  if (signal.aborted) return false;
  const image = $('city-photo').cloneNode(false);
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(6000)]);
  let stop;
  try {
    const aborted = new Promise((resolve) => {
      stop = () => resolve(false);
      timeout.addEventListener('abort', stop, {once:true});
    });
    image.src = photo.url;
    const loaded = await Promise.race([image.decode().then(() => image.naturalWidth > 0, () => false), aborted]);
    if (!loaded || timeout.aborted) {
      image.removeAttribute('src');
      return false;
    }
  } finally {
    timeout.removeEventListener('abort', stop);
  }

  image.addEventListener('error', () => {
    if ($('city-photo') === image) clearCityPhoto();
  }, {once:true});
  $('city-photo').replaceWith(image);
  $('photo-source').href = photo.source;
  $('photo-source').title = photo.title;
  $('photo-source').textContent = photo.author || 'Wikimedia Commons';
  $('photo-license').href = photo.licenseUrl;
  $('photo-license').textContent = photo.license;
  $('photo-credit').hidden = false;
  $('current-weather').classList.add('has-photo');
  return true;
}

async function firstUsablePhoto(candidates, signal) {
  for (const photo of candidates) {
    if (signal.aborted) break;
    if (await showLoadedPhoto(photo, signal)) return photo;
  }
  return null;
}

const metroAreas = [
  {
    city:{id:745044, name:'İstanbul', latitude:41.0082, longitude:28.9784},
    country:'TR', region:'istanbul',
    districts:'adalar arnavutkoy atasehir avcilar bagcilar bahcelievler bakirkoy basaksehir bayrampasa besiktas beykoz beylikduzu beyoglu cekmekoy esenler esenyurt eyupsultan fatih gaziosmanpasa gungoren kadikoy kagithane kartal kucukcekmece maltepe pendik sancaktepe sariyer sultanbeyli sultangazi sile sisli tuzla umraniye uskudar zeytinburnu buyukcekmece catalca silivri'.split(' ')
  },
  {
    city:{id:750269, name:'Bursa', latitude:40.19559, longitude:29.06013},
    country:'TR', region:'bursa', districts:['nilufer','osmangazi','yildirim','gursu','kestel']
  },
  {
    city:{id:5128581, name:'New York City', latitude:40.71278, longitude:-74.00611},
    country:'US', region:'new york', districts:['kings county','queens county','bronx county','richmond county','new york county']
  },
  {
    city:{id:1151254, name:'Phuket', latitude:7.89059, longitude:98.3981},
    country:'TH', region:'phuket', districts:['mueang phuket','amphoe mueang phuket']
  }
];
const parentLookup = new Map();

function administrativeName(value = '') {
  return photoName(value).replace(/ (ili|ilcesi|province|departement)$/, '');
}

function isSubcityPlace(place) {
  return /^(PPLX?|PPLA[2-5]|ADM[2-5])$/.test(place.feature_code ?? '');
}

function metroParent(place) {
  const region = administrativeName(place.admin1);
  const district = administrativeName(place.admin2);
  return metroAreas.find(({city, country, region:metroRegion, districts}) => (
    place.id !== city.id && place.country_code === country && region === metroRegion && districts.includes(district)
  ))?.city;
}

async function searchParent(name, place, signal, topLevel) {
  const key = [place.country_code, place.admin1_id, photoName(name)].join('|');
  let candidates = parentLookup.get(key);
  if (!candidates) {
    const data = await getJSON('https://geocoding-api.open-meteo.com/v1/search', {
      name, count:6, countryCode:place.country_code, language:locale
    }, signal);
    candidates = data.results ?? [];
    parentLookup.set(key, candidates);
  }
  return candidates.find((city) => (
    city.id !== place.id && city.country_code === place.country_code &&
    (place.admin1_id ? city.admin1_id === place.admin1_id : administrativeName(city.admin1) === administrativeName(place.admin1)) &&
    administrativeName(city.name) === administrativeName(name) &&
    /^(PPLC|PPLA|PPLA2)$/.test(city.feature_code) &&
    distanceFrom(place, city.latitude, city.longitude) <= (topLevel ? 25 : 35)
  ));
}

async function parentCities(place, signal) {
  const metro = metroParent(place);
  if (metro) return [metro];
  if (!place.country_code || !isSubcityPlace(place)) return [];
  const names = [...new Set([place.admin4, place.admin3, place.admin2].filter(Boolean))];
  if (place.feature_code === 'PPLX' && place.admin1) names.push(place.admin1);
  const candidates = await Promise.all(names.map((name) => {
    const topLevel = name === place.admin1;
    const query = name.replace(/ (İli|İlçesi|Province|Département)$/i, '');
    return searchParent(query, place, signal, topLevel).catch(() => null);
  }));
  return [...new Map(candidates.filter(Boolean).map((city) => [city.id, city])).values()];
}

async function loadCityPhoto(place) {
  photoRequest?.abort();
  const controller = new AbortController();
  photoRequest = controller;
  clearCityPhoto();
  const {signal} = controller;
  // Use only public geocoder results for city imagery.
  if (place.deviceLocation) return;
  if (isSubcityPlace(place)) {
    for (const parent of await parentCities(place, signal)) {
      if (signal.aborted || await loadPlacePhoto(parent, signal)) return;
    }
  }
  const canonical = metroAreas.find(({city}) => city.id === place.id)?.city;
  if (!signal.aborted) await loadPlacePhoto(canonical ?? place, signal);
}

async function loadPlacePhoto(place, signal) {
  const preferred = (
    photoName(place.name) === 'istanbul' && distanceFrom(place, 41.0082, 28.9784) < 25
  ) ? istanbulPhoto : [1151254, 10238087].includes(place.id) ? phuketPhoto : null;
  if (preferred && await showLoadedPhoto(preferred, signal)) return true;
  // Device coordinates are not sent to Wikimedia.
  if (signal.aborted) return false;
  const key = place.id ?? [place.name, place.latitude, place.longitude].join('|');
  const cached = photoCache.get(key);
  if (cached && await showLoadedPhoto(cached, signal)) return true;
  photoCache.delete(key);
  if (signal.aborted) return false;

  const catalog = await commonsPhotos(catalogFiles(place), signal).catch(() => []);
  let photo = await firstUsablePhoto(catalog.filter(({url}) => url !== cached?.url), signal);
  if (!photo && !signal.aborted) {
    const candidates = await Promise.allSettled(['tr', 'en'].map((lang) => wikipediaFiles(place, lang, signal)));
    const files = candidates.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    const wiki = await commonsPhotos(files, signal).catch(() => []);
    const tried = new Set([cached?.url, ...catalog.map(({url}) => url)]);
    photo = await firstUsablePhoto(wiki.filter(({url}) => !tried.has(url)), signal);
  }
  if (photo && !signal.aborted) photoCache.set(key, photo);
  return Boolean(photo) && !signal.aborted;
}
