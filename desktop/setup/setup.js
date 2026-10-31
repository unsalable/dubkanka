// Setup screen: "starting" for normal launches, the new version coming down when an update was found at launch, the
// step list for the first install (the studio only, about 200 MB; AI features are picked inside the studio later) and
// after updates, the log and retry when something fails. Events come from lib/runtime.js and lib/updater.js through
// main.js.
const $ = (id) => document.getElementById(id);
const setup = window.dkSetup;
const show = (id) => ['starting', 'updating', 'install', 'error'].forEach((s) => ($(s).hidden = s !== id));
$('ver').textContent = window.dkDesktop ? 'v' + window.dkDesktop.version : '';

let steps = [];
let t0 = 0;
let timer = 0;
const logLines = [];

function log(line) {
  logLines.push(line);
  if (logLines.length > 300) logLines.shift();
  $('log').textContent = logLines.join('\n');
}

function renderSteps() {
  $('steps').innerHTML = '';
  for (const s of steps) {
    const li = document.createElement('li');
    li.className = 'step ' + s.state;
    li.id = 'st-' + s.id;
    li.innerHTML = '<span class="name"></span><span class="size"></span><span class="detail"></span>';
    li.querySelector('.name').textContent = s.label;
    li.querySelector('.size').textContent = s.state === 'done' ? 'hazır' : s.size || '';
    li.querySelector('.detail').textContent = s.detail || '';
    $('steps').appendChild(li);
  }
}

function tick() {
  const s = Math.floor((Date.now() - t0) / 1000);
  $('elapsed').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function handle(ev) {
  if (ev.type === 'phase') {
    if (ev.phase === 'server' && !$('install').hidden) {
      $('title').textContent = 'Stüdyo açılıyor';
      $('footText').textContent = 'Birkaç saniye…';
    }
    else if (ev.phase === 'server') $('startText').textContent = 'Stüdyo açılıyor…';
    else if (ev.phase === 'update-check') $('startText').textContent = 'Güncelleme kontrol ediliyor…';
    else if (ev.phase === 'starting' && $('install').hidden) {
      $('startText').textContent = 'Başlatılıyor…';
      show('starting');
    }
  } else if (ev.type === 'update') {
    show('updating');
    $('updTitle').textContent = ev.installing ? 'Yeni sürüm kuruluyor' : `DubKanka ${ev.version} indiriliyor`;
    $('updLead').textContent = ev.installing ? 'Uygulama birazdan yeni sürümle açılacak.' : 'İnince kendiliğinden kurulur ve uygulama yeniden açılır.';
    $('updBar').style.transform = `scaleX(${ev.progress || 0})`;
    $('updPct').textContent = Math.round((ev.progress || 0) * 100) + '%';
    $('updSkip').hidden = !!ev.installing;
  } else if (ev.type === 'plan') {
    steps = ev.steps.map((s) => ({ ...s }));
    $('title').textContent = ev.firstRun ? 'DubKanka hazırlanıyor' : 'Güncelleme uygulanıyor';
    $('lead').textContent = ev.firstRun
      ? 'Bir kereye mahsus, stüdyonun kendisi iniyor: yaklaşık 200 MB, birkaç dakika. Yazıya dökme, müzik ayırma gibi yapay zeka özelliklerini açılınca sen seçeceksin.'
      : 'Yeni sürüm birkaç paketi güncelliyor; sadece değişenler indiriliyor.';
    t0 = Date.now();
    clearInterval(timer);
    timer = setInterval(tick, 1000);
    show('install');
    renderSteps();
  } else if (ev.type === 'step') {
    const s = steps.find((x) => x.id === ev.id);
    if (s) {
      s.state = ev.state;
      if (ev.state === 'running') s.ran = true;
      if (ev.label) s.label = ev.label;
      if (ev.size) s.size = ev.size;
      if (ev.state !== 'running') s.detail = '';
      renderSteps();
    }
  } else if (ev.type === 'progress') {
    const s = steps.find((x) => x.id === ev.id);
    if (s && ev.detail) {
      s.detail = ev.detail;
      const d = document.querySelector(`#st-${ev.id} .detail`);
      if (d) d.textContent = ev.detail;
    }
    if (ev.overall != null) {
      $('bar').style.transform = `scaleX(${ev.overall})`;
      $('pct').textContent = Math.round(ev.overall * 100) + '%';
    }
  } else if (ev.type === 'log') {
    log(ev.line);
  } else if (ev.type === 'error') {
    clearInterval(timer);
    $('errMsg').textContent = ev.message;
    $('errLog').textContent = (ev.tail || logLines.slice(-40)).join('\n');
    show('error');
  }
}

// events from before this page loaded (a reload during setup) come back once; live ones follow
let live = 0;
setup.onEvent((ev) => {
  live++;
  handle(ev);
});
setup.replay().then((evs) => !live && evs.forEach(handle));
$('retry').onclick = () => {
  show('starting');
  $('startText').textContent = 'Yeniden deneniyor…';
  setup.retry();
};
$('updSkip').onclick = () => {
  // the studio opens now; the new version keeps downloading and is installed when the app quits
  show('starting');
  $('startText').textContent = 'Başlatılıyor…';
  setup.skipUpdate();
};
$('logs').onclick = () => setup.openLogs();
$('quit').onclick = () => setup.quit();
