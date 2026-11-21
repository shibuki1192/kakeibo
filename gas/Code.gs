/**
 * 自分用 家計簿（Gmail カード速報 → スプレッドシート自動記帳）
 * 初回は setup() を1回だけ実行してください。
 */

// ===== 初期設定値（画面の「設定」で変更した内容が優先されます） =====
const CONFIG = {
  // カード速報メールの差出人（部分一致OK）
  SENDERS: [
    'jp-bank.japanpost.jp', // ゆうちょデビット
    'rakuten-card.co.jp',
    'vpass.ne.jp',          // 三井住友カード
    'smbc-card.com',
    'aeon.co.jp',
    'saisoncard.co.jp',
    'jcb.co.jp',
    'paypay-card.co.jp',
    'epos-card.co.jp',
  ],
  // 件名に含まれるキーワード（どれか1つ）
  SUBJECT_WORDS: ['利用', '速報', 'カード', 'デビット'],
  DONE_LABEL: '家計簿済',
  SHEET_NAME: '支出',
  CATEGORIES: ['食費', '日用品', '交通', '娯楽', '通信', '光熱費', '医療', 'その他'],
  INCOME_CATEGORIES: ['給与', '賞与', '副収入', '返金', 'その他収入'],
  OFF_BUDGET: ['特別費'], // 予算外のカテゴリ：支出には含めるが、予算残りの計算には含めない
  // 店名の置き換え（店名に from が含まれたら、一覧では to と表示。上が優先）
  STORE_ALIAS: [
    { from: 'セブン', to: 'コンビニ' },
    { from: 'SEVEN-ELEVEN', to: 'コンビニ' },
    { from: 'COCA-COLA VENDING', to: '自販機' },
  ],
  // 店名にこの文字が含まれたら「集計しない」で取り込む（Suicaチャージなど）
  EXCLUDE_STORES: ['モバイルSUICA', 'MOBILE SUICA'],
  // 毎月の予算（カテゴリ名: 金額）
  BUDGETS: {
    '食費': 65000, '交通費': 5000, '日用品': 10000, '猫関連': 15000, '医療費・医薬品': 10000,
    '娯楽費': 10000, 'サブスク': 32000, '家賃': 101000, '水道光熱費': 20000, '通信費': 5000,
    '衣服・美容': 15000, '交際費': 5000, 'その他': 6000,
  },
  // 支払方法。type: instant（使った日に口座から） / card（締め日・支払日で口座から）
  //          cash（現金：今月の出金に含める） / prepaid（au Payなどチャージ式：出金に含めない）
  // senders: この差出人のメールはこの支払方法として取り込む
  PAY_METHODS: [
    // short: 明細に表示するラベル
    { id: 'yucho', name: 'ゆうちょ（デビット・口座引落）', short: 'Y-Deb', type: 'instant', senders: ['jp-bank.japanpost.jp'] },
    { id: 'cash',  name: '現金', short: '現金', type: 'cash', senders: [] },
    // payOffset：締め日から何か月後に払うか（0＝当月、1＝翌月、2＝翌々月）
    { id: 'life',  name: 'ライフカード', short: 'ライフ', type: 'card', closeDay: 5, payOffset: 0, payDay: 27, shift: 'next', senders: ['lifecard.co.jp'] },
    { id: 'au',    name: 'au携帯合算', short: 'au', type: 'card', closeDay: 31, payOffset: 1, payDay: 25, shift: 'next', senders: [] },
  ],
  // 店名にこの文字が含まれるメールは「振替」として取り込む（to：振替先の支払方法ID。空なら最初のチャージ式）
  TRANSFER_RULES: [{ match: 'PAY残高チャージ', to: '' }],
  // 店名にこの文字が含まれたら自動でカテゴリを付ける
  AUTO_CATEGORY: {
    '食費': ['セブン', 'ローソン', 'ファミリーマート', 'マクドナルド', 'スターバックス', 'イオン', 'ライフ', 'ＵＢＥＲ', 'UBER'],
    '交通': ['ＪＲ', 'JR', 'モバイルＳＵＩＣＡ', 'SUICA', 'タクシー', 'ENEOS', 'ＥＮＥＯＳ'],
    '通信': ['ドコモ', 'ソフトバンク', 'ＡＵ', 'KDDI', '楽天モバイル'],
    '娯楽': ['NETFLIX', 'ＮＥＴＦＬＩＸ', 'SPOTIFY', 'AMAZON PRIME', 'APPLE.COM'],
    '日用品': ['マツモトキヨシ', 'ウエルシア', 'ダイソー', 'ニトリ', 'AMAZON', 'ＡＭＡＺＯＮ'],
  },
};

const HEADERS = ['日付', '金額', '店名', 'カテゴリ', 'メモ', 'メールID', '集計', '表示店名', '支払方法', '区分'];
const INCOME = '入金'; // 区分列（J列）が「入金」なら入金、空なら支出
const TRANSFER = '振替'; // 「振替」なら口座から現金・チャージ式への移動（カテゴリ列＝移動先の支払方法ID）

// ===== 設定の読み書き（画面から編集） =====
let fixedById_ = null;
// 1回の処理の中では設定を1度だけ読み込む（明細ごとに読み込むと非常に遅くなるため）
// スクリプトに保存してある値は、1回の処理につき1度だけまとめて読む
let propsMemo_ = null;
function props_() {
  return propsMemo_ || (propsMemo_ = PropertiesService.getScriptProperties().getProperties());
}
function setProps_(obj) {
  PropertiesService.getScriptProperties().setProperties(obj);
  if (propsMemo_) Object.assign(propsMemo_, obj);
}
function delProp_(k) {
  PropertiesService.getScriptProperties().deleteProperty(k);
  if (propsMemo_) delete propsMemo_[k];
}

let settingsMemo_ = null;
function getSettings_() {
  return settingsMemo_ || (settingsMemo_ = readSettings_());
}
function readSettings_() {
  const saved = props_().settings;
  const s = saved ? JSON.parse(saved) : {};
  const storeRules = s.storeRules || mergeStoreRules_(s.storeAlias || CONFIG.STORE_ALIAS, s.autoCategory || CONFIG.AUTO_CATEGORY);
  return {
    storeRules,
    // 以前の形（ほかの処理用。storeRules から作る）
    storeAlias: storeRules.filter(r => r.name).map(r => ({ from: r.match, to: r.name })),
    senders: s.senders || CONFIG.SENDERS,
    subjectWords: s.subjectWords || CONFIG.SUBJECT_WORDS,
    categories: s.categories || CONFIG.CATEGORIES,
    incomeCategories: s.incomeCategories || CONFIG.INCOME_CATEGORIES,
    fixed: s.fixed || [],
    excludeStores: s.excludeStores || CONFIG.EXCLUDE_STORES,
    transferRules: s.transferRules || CONFIG.TRANSFER_RULES,
    budgets: s.budgets || CONFIG.BUDGETS,
    offBudget: s.offBudget || CONFIG.OFF_BUDGET,
    balances: s.balances || {}, // 口座の開始残高 { '2026-10': 123456 }（〇月度の開始日時点）
    cashBalances: s.cashBalances || {}, // 手元の現金の開始残高
    period: s.period || { day: 1, shift: 'none' }, // 家計簿の開始日（給料日など）
    payMethods: (s.payMethods || CONFIG.PAY_METHODS).map(pm => Object.assign({}, pm, {
      // ラベル未設定なら初期値（なければ名前）を使う
      short: pm.short || (CONFIG.PAY_METHODS.find(d => d.id === pm.id) || {}).short || pm.name,
      // 以前の版で「現金・チャージ式」にしていた現金以外のもの（au Payなど）はチャージ式に移す
      type: !s.payTypesV2 && pm.type === 'cash' && pm.id !== 'cash' ? 'prepaid' : pm.type,
    }, !s.lifeCloseV2 && pm.id === 'life' && Number(pm.closeDay) === 31 && Number(pm.payOffset) === 1
      ? { closeDay: 5, payOffset: 0 } : {})),  // ライフカードの締め日を「末日締め翌月27日」→「5日締め当月27日」に直す（1回だけ）
  };
}

function saveSettings(key, s) {
  check_(key);
  const clean = arr => (arr || []).map(x => String(x).trim()).filter(Boolean);
  const auto = {};
  Object.entries(s.autoCategory || {}).forEach(([k, v]) => {
    const key = String(k).trim();
    if (key) auto[key] = clean(v);
  });
  const storeRules = s.storeRules
    ? s.storeRules.map(r => ({ match: String(r.match || '').trim(), name: String(r.name || '').trim(), category: String(r.category || '').trim() }))
        .filter(r => r.match && (r.name || r.category))
    : mergeStoreRules_(s.storeAlias || [], auto);
  setProps_({ fixedApplied: '', settings: JSON.stringify({
    senders: clean(s.senders),
    storeRules,
    subjectWords: clean(s.subjectWords),
    categories: clean(s.categories),
    incomeCategories: clean(s.incomeCategories),
    fixed: (s.fixed || [])
      .map(f => ({
        id: String(f.id || Utilities.getUuid()),
        name: String(f.name || '').trim(),
        amount: Math.round(Number(f.amount) || 0),
        day: Math.min(Math.max(Math.round(Number(f.day) || 1), 1), 31),
        category: String(f.category || '未分類'),
        since: String(f.since || ymd_(new Date())),
        until: /^\d{4}-\d{2}-\d{2}$/.test(String(f.until || '')) ? String(f.until) : '',
        shift: ['next', 'prev'].includes(f.shift) ? f.shift : 'none',
        mode: f.mode === 'mail' ? 'mail' : 'auto',   // auto: 自動で記録 / mail: メールで確定
        match: String(f.match || '').trim(),          // メールで確定するときの店名キーワード
        payMethod: String(f.payMethod || ''),         // 支払方法（空なら口座）
        kind: f.kind === 'income' ? 'income' : 'expense', // 支出 / 定期入金
      }))
      .filter(f => f.name && f.amount > 0),
    excludeStores: clean(s.excludeStores),
    transferRules: (s.transferRules || [])
      .map(t => ({ match: String(t.match || '').trim(), to: String(t.to || '') }))
      .filter(t => t.match),
    payMethods: (s.payMethods || []).map(pm => ({
      id: String(pm.id || Utilities.getUuid().slice(0, 8)),
      name: String(pm.name || '').trim(),
      short: String(pm.short || '').trim().slice(0, 12),
      type: ['instant', 'card', 'cash', 'prepaid'].includes(pm.type) ? pm.type : 'instant',
      closeDay: Math.min(Math.max(Math.round(Number(pm.closeDay) || 31), 1), 31),
      payOffset: [0, 1, 2].includes(Number(pm.payOffset)) ? Number(pm.payOffset) : 1,
      payDay: Math.min(Math.max(Math.round(Number(pm.payDay) || 27), 1), 31),
      shift: ['next', 'prev'].includes(pm.shift) ? pm.shift : 'none',
      senders: clean(pm.senders),
    })).filter(pm => pm.name),
    period: {
      day: Math.min(Math.max(Math.round(Number((s.period || {}).day) || 1), 1), 31),
      shift: ['next', 'prev'].includes((s.period || {}).shift) ? s.period.shift : 'none',
    },
    budgets: Object.fromEntries(Object.entries(s.budgets || {})
      .map(([k, v]) => [String(k).trim(), Math.round(Number(v) || 0)])
      .filter(([k, v]) => k && v > 0)),
    payTypesV2: true,
    lifeCloseV2: true,
    offBudget: clean(s.offBudget),
    balances: Object.fromEntries(Object.entries(s.balances || {})
      .filter(([k, v]) => /^\d{4}-\d{2}$/.test(k) && v !== null && v !== '' && isFinite(Number(v)))
      .map(([k, v]) => [k, Math.round(Number(v))])),
    cashBalances: Object.fromEntries(Object.entries(s.cashBalances || {})
      .filter(([k, v]) => /^\d{4}-\d{2}$/.test(k) && v !== null && v !== '' && isFinite(Number(v)))
      .map(([k, v]) => [k, Math.round(Number(v))])),
  }) });
  settingsMemo_ = null; fixedById_ = null;
}

// 画面から設定を読み込む
function loadSettings(key) {
  check_(key);
  return getSettings_();
}

// ===== 合言葉（URL の ?key=〜）=====
let keyMemo_ = null;
function getKey_() {
  if (keyMemo_) return keyMemo_;
  let k = props_().accessKey;
  if (!k) { k = Utilities.getUuid().replace(/-/g, ''); setProps_({ accessKey: k }); }
  return keyMemo_ = k;
}

function check_(key) {
  if (key !== getKey_()) throw new Error('unauthorized');
}

// これを実行すると、URL の末尾に付ける文字列が「実行ログ」に表示されます
function showKey() {
  Logger.log('WebアプリURLの末尾に付ける文字列 →  ?key=' + getKey_());
}

// 合言葉を作り直す（URLが漏れたかもしれないとき）
function resetKey() {
  delProp_('accessKey');
  keyMemo_ = null;
  showKey();
}

// 設定を初期値に戻す
function resetSettings(key) {
  check_(key);
  delProp_('settings');
  setProps_({ fixedApplied: '' });
  settingsMemo_ = null; fixedById_ = null;
}

// ===== 初期設定（1回だけ実行） =====
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) sh = ss.insertSheet(CONFIG.SHEET_NAME);
  if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
  sh.setFrozenRows(1);

  if (!GmailApp.getUserLabelByName(CONFIG.DONE_LABEL)) GmailApp.createLabel(CONFIG.DONE_LABEL);

  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('fetchCardMails').timeBased().everyMinutes(10).create();

  fetchCardMails();
}

// ===== 固定費の自動記帳 =====
// 日付 → 'yyyy-MM-dd'。全明細に対して何度も呼ぶので、Google のサービス（Utilities.formatDate）は使わない
const pad2_ = n => (n < 10 ? '0' : '') + n;
function ymd_(d) {
  return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate());
}
function ym_(d) {
  return d.getFullYear() + '-' + pad2_(d.getMonth() + 1);
}

// ===== 休日・祝日の判定 =====
const holidayMemo_ = {};

// Googleカレンダーの「日本の祝日」から祝日一覧を取得
// カレンダーの読み込みは遅いので、結果を30日間保存して使い回す
function getHolidays_(y) {
  if (holidayMemo_[y]) return holidayMemo_[y];
  const saved = JSON.parse(props_()['hol' + y] || 'null');
  let list;
  if (saved && saved.list.length && Date.now() - saved.t < 30 * 864e5) {
    list = saved.list;
  } else {
    list = [];
    try {
      const cal = CalendarApp.getCalendarById('ja.japanese#holiday@group.v.calendar.google.com');
      if (cal) list = cal.getEvents(new Date(y, 0, 1), new Date(y + 1, 0, 1)).map(e => ymd_(e.getAllDayStartDate()));
    } catch (e) { console.warn('祝日の取得に失敗: ' + e); }
    if (list.length) setProps_({ ['hol' + y]: JSON.stringify({ t: Date.now(), list }) });
    else if (saved) list = saved.list; // 取得に失敗したら古いデータを使う
  }
  return holidayMemo_[y] = new Set(list);
}

// 土日・祝日・年末年始（12/31〜1/3、銀行休業日）なら true
function isHoliday_(d) {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return true;
  const md = (d.getMonth() + 1) * 100 + d.getDate();
  if (md === 1231 || md === 101 || md === 102 || md === 103) return true;
  return getHolidays_(d.getFullYear()).has(ymd_(d));
}

// 休日なら前後の平日にずらす（mode: 'next' / 'prev' / 'none'）
function shiftDate_(d, mode) {
  if (mode !== 'next' && mode !== 'prev') return d;
  const x = new Date(d);
  const step = mode === 'next' ? 1 : -1;
  for (let i = 0; i < 15 && isHoliday_(x); i++) x.setDate(x.getDate() + step);
  return x;
}

// 祝日カレンダーの許可と動作確認用（エディタから1回実行してください）
function testHolidays() {
  const y = new Date().getFullYear();
  Logger.log(y + '年の祝日：' + [...getHolidays_(y)].join(', '));
}

// 固定費の y年 m月（m は 0始まり）分の引き落とし日と記録ID。対象外なら null
function fixedOccurrence_(f, y, m) {
  const first = new Date(y, m, 1);
  y = first.getFullYear(); m = first.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  const base = new Date(y, m, Math.min(f.day, lastDay)); // 本来の引き落とし日
  const bs = ymd_(base);
  if (bs < f.since) return null;
  if (f.until && bs > f.until) return null; // 終了日より後は記録しない
  return {
    date: shiftDate_(base, f.shift), // 休日ならずらした日
    id: `fixed:${f.id}:${y}-${String(m + 1).padStart(2, '0')}`,
    ym: `${y}-${String(m + 1).padStart(2, '0')}`, // 本来の引き落とし月
  };
}

// 記録済み（または削除済み）の固定費ID
function knownIds_(ids) {
  const known = new Set(ids.map(String));
  getSkipped_().forEach(id => known.add(id));
  return known;
}

// 先月分と今月分で、引き落とし日を過ぎたのにまだ記録されていない固定費を追加
function applyFixed_() {
  // 同じ日に何度も確認しない（設定を変えたときはやり直す）
  const stamp = ymd_(new Date());
  if (props_().fixedApplied === stamp) return;
  const fixed = getSettings_().fixed;
  if (!fixed.length) { setProps_({ fixedApplied: stamp }); return; }
  const sh = getSheet_();
  const last = sh.getLastRow();
  const known = knownIds_(last < 2 ? [] : sh.getRange(2, 6, last - 1, 1).getValues().flat());

  const now = new Date();
  const today = ymd_(now);
  [-1, 0].forEach(off => {
    fixed.forEach(f => {
      if (f.mode === 'mail') return; // メールで確定するものは自動記録しない
      const o = fixedOccurrence_(f, now.getFullYear(), now.getMonth() + off);
      if (!o || ymd_(o.date) > today || known.has(o.id)) return;
      sh.appendRow(fixedRow_(f, o, f.amount));
      known.add(o.id);
    });
  });
  setProps_({ fixedApplied: stamp });
}

// 削除した固定費の記録は、再び自動追加しない
let skippedMemo_ = null;
function getSkipped_() {
  if (skippedMemo_) return skippedMemo_;
  const v = props_().skippedFixed;
  return skippedMemo_ = v ? JSON.parse(v) : [];
}
function addSkipped_(id) {
  const list = getSkipped_().concat([id]).slice(-500);
  setProps_({ skippedFixed: JSON.stringify(list) });
  skippedMemo_ = list;
}

// ===== Gmail から取り込み（10分ごとに自動実行） =====
function fetchCardMails() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return; // 画面で保存中なら、次の回に取り込む
  try { fetchCardMailsLocked_(); } finally { lock.releaseLock(); }
}
// 一度だけ、取り込む範囲を広げる（終わったら印を付けて、以後は直近30日だけ）
const MAIL_BACKFILL_ = { key: 'backfill_2026-08', after: '2026/08/01' };

function fetchCardMailsLocked_() {
  applyFixed_();
  const st = getSettings_();
  const senders = [...new Set(st.senders.concat(...st.payMethods.map(pm => pm.senders || [])))];
  if (!senders.length) return;
  const from = senders.map(s => `from:${s}`).join(' OR ');
  const subj = st.subjectWords.length
    ? '(' + st.subjectWords.map(s => `subject:${s}`).join(' OR ') + ')'
    : '';
  const backfill = !props_()[MAIL_BACKFILL_.key];
  const range = backfill ? `after:${MAIL_BACKFILL_.after}` : 'newer_than:30d';
  const query = `(${from}) ${subj} ${range} -label:${CONFIG.DONE_LABEL}`;

  const sh = getSheet_();
  const known = new Set(sh.getRange(2, 6, Math.max(sh.getLastRow() - 1, 1), 1).getValues().flat());
  const label = GmailApp.getUserLabelByName(CONFIG.DONE_LABEL) || GmailApp.createLabel(CONFIG.DONE_LABEL);
  const started = Date.now();

  // 取り込んだ会話には「家計簿済」が付いて次の検索に出なくなるので、50件ずつ繰り返す
  // 範囲を広げたときは件数が多いので、最大10回（時間がかかりすぎたら次の回に続きを取り込む）
  let finished = false;
  for (let round = 0; round < (backfill ? 10 : 1); round++) {
    const threads = GmailApp.search(query, 0, 50);
    threads.forEach(th => {
      th.getMessages().forEach(msg => {
        const id = msg.getId();
        if (known.has(id)) return;
        const r = parseMail_(msg);
        if (r) {
          const method = methodForSender_(msg.getFrom(), st.payMethods);
          const tr = transferTarget_(r.store, st);
          if (tr) { // au Pay へのチャージなど：支出ではなく振替として記録
            sh.appendRow([r.date, r.amount, r.store, tr, '', id, true, '', method, TRANSFER]);
          } else {
            const counted = !st.excludeStores.some(w => norm_(r.store).includes(norm_(w)));
            sh.appendRow([r.date, r.amount, r.store, guessCategory_(r.store, st.storeRules), '', id, counted, '', method]);
          }
          known.add(id);
        }
      });
      th.addLabel(label);
    });
    if (threads.length < 50) { finished = true; break; }
    if (Date.now() - started > 4 * 60 * 1000) break; // Apps Script の時間制限（6分）の前にやめる
  }
  if (backfill && finished) setProps_({ [MAIL_BACKFILL_.key]: new Date().toISOString() });
}

// ===== メール本文の解析 =====
function parseMail_(msg) {
  const body = msg.getPlainBody().replace(/\r/g, '').replace(/[：]/g, ':');

  // 金額
  const amountPatterns = [
    /(?:ご?利用金額|お支払い?金額|ご請求金額|金額)\s*[:：]?\s*[¥￥]?\s*([0-9,，]+)\s*円?/,
    /[¥￥]\s*([0-9,，]+)/,
    /([0-9,，]+)\s*円/,
  ];
  let amount = null;
  for (const p of amountPatterns) {
    const m = body.match(p);
    if (m) { amount = Number(m[1].replace(/[,，]/g, '')); break; }
  }
  if (!amount) return null;

  // 店名
  const storePatterns = [
    /(?:ご?利用先|ご?利用店舗?名?|加盟店名?|お店)\s*[:：]?\s*(.+)/,
  ];
  let store = '';
  for (const p of storePatterns) {
    const m = body.match(p);
    if (m) { store = m[1].trim().slice(0, 50); break; }
  }

  // 日付（取れなければメール受信日）
  let date = msg.getDate();
  const dm = body.match(/(?:ご?利用日時?)\s*[:：]?\s*(\d{4})[\/年.\-](\d{1,2})[\/月.\-](\d{1,2})/);
  if (dm) date = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]));

  return { date, amount, store };
}

// 全角/半角・大文字/小文字を区別せずに比較するための正規化
function norm_(t) {
  return String(t || '').normalize('NFKC').toUpperCase().replace(/[－―ー‐]/g, '-');
}

// 店名ルール（上にあるものが優先）でカテゴリを決める。当てはまらなければ未分類
function guessCategory_(store, rules) {
  const s = norm_(store);
  const hit = (rules || []).find(r => r.category && s.includes(norm_(r.match)));
  return hit ? hit.category : '未分類';
}

// 以前の「店名の置き換え」と「自動分類ルール」を、1つの店名ルール表にまとめる
// 同じ文字のルールが両方にあれば1行にする。順番は置き換え → 自動分類（カテゴリ順）
function mergeStoreRules_(aliases, auto) {
  const rows = [];
  const find = m => rows.find(r => norm_(r.match) === norm_(m));
  (aliases || []).forEach(a => {
    if (!a || !a.from) return;
    const r = find(a.from);
    if (r) { if (!r.name) r.name = String(a.to || ''); }
    else rows.push({ match: String(a.from), name: String(a.to || ''), category: '' });
  });
  Object.entries(auto || {}).forEach(([cat, words]) => (words || []).forEach(w => {
    if (!w) return;
    const r = find(w);
    if (r) { if (!r.category) r.category = cat; }
    else rows.push({ match: String(w), name: '', category: cat });
  }));
  return rows;
}

// 未分類の支出に、今の店名ルールでカテゴリを付け直す
function applyRulesToUncategorized(key) {
  check_(key);
  const sh = getSheet_();
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const rules = getSettings_().storeRules;
  const vals = sh.getRange(2, 1, last - 1, 10).getValues();
  let n = 0;
  vals.forEach((r, i) => {
    if (String(r[3]) !== '未分類' || r[9] === INCOME || r[9] === TRANSFER) return;
    const c = guessCategory_(String(r[2] || ''), rules);
    if (c !== '未分類') { sh.getRange(i + 2, 4).setValue(c); n++; }
  });
  return n;
}

function applyAlias_(store, aliases) {
  const s = norm_(store);
  const hit = (aliases || []).find(a => s.includes(norm_(a.from)));
  return hit ? hit.to : store;
}

// ===== Web アプリ =====
function doGet(e) {
  const key = getKey_();
  const p = (e && e.parameter) || {};
  // ウィジェット用：数字だけを JSON で返す（?key=…&format=json）
  if (p.format === 'json') {
    const body = p.key === key ? widgetData_(key) : { error: 'URLが正しくありません' };
    return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
  }
  if (p.key !== key) {
    return HtmlService.createHtmlOutput('<p style="font-size:20px">URLが正しくありません</p>');
  }
  const t = HtmlService.createTemplateFromFile('Index');
  t.key = key;
  t.add = p.add === 'income' || p.add === 'expense' ? p.add : ''; // ウィジェットの＋／−ボタンから開いたとき
  // 最初に表示するデータをページに埋め込んで、読み込みのやり取りを1回減らす
  try { t.initial = JSON.stringify(getMonth(key, 'current')).replace(/</g, '\\u003c'); }
  catch (err) { t.initial = 'null'; }
  return t.evaluate()
    .setTitle('家計簿')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

// ===== ウィジェット用の集計（画面と同じ計算） =====
function widgetData_(key) {
  const d = getMonth(key, 'current');
  const sum = a => a.reduce((t, i) => t + i.amount, 0);
  const exp = d.items.filter(i => i.kind === 'expense');
  const inc = d.items.filter(i => i.kind === 'income');
  const counted = exp.filter(i => !i.excluded && !i.pending);
  const pend = exp.filter(i => i.pending);
  const spending = sum(counted) + sum(pend);                                          // 今月の支出（確定前を含む）
  const income = sum(inc.filter(i => !i.pending && !i.excluded)) + sum(inc.filter(i => i.pending)); // 今月の入金
  const outflow = d.outflow.total + (d.outflow.pending || 0);                          // 今月の出金
  const byCat = {};
  counted.concat(pend).forEach(i => { byCat[i.category] = (byCat[i.category] || 0) + i.amount; }); // 確定前も含める
  const names = d.categories.filter(c => d.budgets[c]).concat(Object.keys(d.budgets).filter(c => !d.categories.includes(c)));
  const budgetTotal = Object.values(d.budgets).reduce((a, v) => a + v, 0);
  const [y, m] = d.ym.split('-').map(Number);
  return {
    label: `${y}年${m}月${d.custom ? '度' : ''}`, period: d.period,
    spending, income, outflow, balance: income - outflow,
    budgetTotal, budgetLeft: budgetTotal - (spending - sum(counted.concat(pend).filter(i => (d.offBudget || []).includes(i.category)))), // 予算外は除く
    categories: names.map(c => ({ name: c, budget: d.budgets[c], spent: byCat[c] || 0 })),
    updated: new Date().toISOString(),
  };
}

let sheetMemo_ = null;
function getSheet_() {
  if (sheetMemo_) return sheetMemo_;
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  // 古いシートに列を追加（見出しは1回でまとめて読む）
  const head = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  HEADERS.forEach((h, i) => { if (i >= 6 && head[i] === '') sh.getRange(1, i + 1).setValue(h); });
  return sheetMemo_ = sh;
}

// 指定月のデータ（ym = '2026-10'）
// ===== 家計簿の期間（〇月度） =====
// y年m月度の開始日（m は 1始まり）。開始日が休日なら設定に応じてずらす
function periodStart_(y, m, period) {
  const first = new Date(y, m - 1, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return shiftDate_(new Date(first.getFullYear(), first.getMonth(), Math.min(period.day, lastDay)), period.shift);
}
function periodRange_(y, m, period) {
  const start = periodStart_(y, m, period);
  const end = periodStart_(y, m + 1, period);
  end.setDate(end.getDate() - 1);
  return { start: ymd_(start), end: ymd_(end) };
}
// 今日が含まれる〇月度（'2026-10' の形）
function currentPeriodYm_(period) {
  const now = new Date(), today = ymd_(now);
  for (let off = 1; off >= -1; off--) {
    const d = new Date(now.getFullYear(), now.getMonth() + off, 1);
    const r = periodRange_(d.getFullYear(), d.getMonth() + 1, period);
    if (r.start <= today && today <= r.end) return ym_(d);
  }
  return ym_(now);
}

// ym: '2026-10'（〇月度）または 'current'（今日を含む月度）
function getMonth(key, ym) {
  check_(key);
  applyFixed_();
  const sh = getSheet_();
  const last = sh.getLastRow();
  const period = getSettings_().period;
  if (ym === 'current') ym = currentPeriodYm_(period);
  const [y, m] = ym.split('-').map(Number);
  const P = periodRange_(y, m, period);
  const rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, 10).getValues();
  ensureIds_(sh, rows);
  const aliases = getSettings_().storeAlias;
  // 分割された明細のグループ（元のID）
  const splitBases = new Set(rows.map(r => String(r[5])).filter(id => id.includes('#split')).map(id => id.split('#split')[0]));
  const items = [];
  rows.forEach((r, i) => {
    const d = new Date(r[0]);
    if (!r[0]) return;
    const ds = ymd_(d);
    if (P.start <= ds && ds <= P.end) items.push(rowToItem_(r, i + 2, aliases, splitBases));
  });
  // 確定前：これから引き落とされる固定費（シートには書かず表示だけ）
  const st = getSettings_();
  const known = knownIds_(rows.map(r => r[5]));
  const today = ymd_(new Date());
  // 「メールで確定」の照合用：月ごとの店名（元の店名・表示店名）
  const storesByMonth = {};
  rows.forEach(r => {
    if (!r[0]) return;
    const k = ymd_(new Date(r[0])).slice(0, 7);
    (storesByMonth[k] = storesByMonth[k] || []).push(norm_(r[2]) + '\n' + norm_(r[7]));
  });
  [-2, -1, 0, 1].forEach(off => {
    st.fixed.forEach(f => {
      const o = fixedOccurrence_(f, y, m - 1 + off);
      if (!o) return;
      const ds = ymd_(o.date);
      if (ds < P.start || ds > P.end || known.has(o.id)) return;
      if (f.mode === 'mail') {
        // その月（本来の引き落とし月）にキーワードを含む明細があれば確定済み
        const kw = norm_(f.match || f.name);
        const hit = (storesByMonth[o.ym] || []).concat(storesByMonth[ds.slice(0, 7)] || []).some(t => kw && t.includes(kw));
        if (hit) return;
      } else if (ds <= today) {
        return; // 自動で記録するものは、日付が来たら記録済み
      }
      known.add(o.id);
      items.push({
        row: 0, date: ds, amount: f.amount,
        store: f.name, rawStore: f.name, aliasStore: f.name,
        category: f.category, memo: '', source: 'fixed', excluded: false, pending: true,
        pendingMode: f.mode, overdue: f.mode === 'mail' && ds < today,
        method: f.kind === 'income' ? defaultMethod_('fixed') : (f.payMethod || defaultMethod_('fixed')),
        kind: f.kind === 'income' ? 'income' : 'expense', occ: o.id,
      });
    });
  });

  // 日付の新しい順。同じ日の中では分割した明細が隣り合うよう、グループの最初の行の順に並べる
  const firstRow = {};
  items.forEach(it => {
    if (it.split && it.row) firstRow[it.group] = Math.min(firstRow[it.group] || Infinity, it.row);
  });
  const pos = it => (it.split && firstRow[it.group]) || it.row;
  items.sort((a, b) => b.date.localeCompare(a.date) || pos(a) - pos(b) || a.row - b.row);
  const outflow = computeOutflow_(rows, P, st.payMethods);
  // カード払いで使った分を「何月度に引き落とされるか」ごとにまとめる
  const due = {};
  items.forEach(it => {
    if (it.pending || it.excluded || it.kind !== 'expense') return;
    const m = st.payMethods.find(pm => pm.id === it.method);
    if (!m || m.type !== 'card') return;
    const k = periodYmOf_(cardPayDate_(it.date, m), period);
    due[k] = (due[k] || 0) + it.amount;
  });
  const cardDue = Object.keys(due).sort().map(k => ({ ym: k, amount: due[k] }));
  outflow.pending = items.filter(it => it.pending && it.kind !== 'income' && ['instant', 'cash'].includes(methodType_(it.method, st.payMethods))).reduce((a, it) => a + it.amount, 0);
  // 口座（ゆうちょ）と手元の現金の残高（today は上で定義済み）
  const now = P.start <= today && today <= P.end;
  const state = now ? 'now' : P.end < today ? 'past' : 'future';
  const sumPend = f => items.filter(it => it.pending && f(it)).reduce((a, it) => a + it.amount, 0);
  const pendIncome = sumPend(it => it.kind === 'income');
  const pendBankOut = sumPend(it => it.kind === 'expense' && methodType_(it.method, st.payMethods) === 'instant');
  const pendCash = sumPend(it => it.kind === 'expense' && methodType_(it.method, st.payMethods) === 'cash');
  const oToday = now ? computeOutflow_(rows, P, st.payMethods, today) : outflow;
  let bank = null, cash = null;
  const sb = startBalance_(ym, rows, st, 'bank');
  if (sb) {
    const inAll = incomeOf_(rows, P) + pendIncome;                       // この期間の入金（予定を含む）
    const inNow = now ? incomeOf_(rows, P, today) : inAll;               // 今日までの入金
    const outAll = outflow.bankOut + pendBankOut;                        // この期間に口座から出る額（予定を含む）
    const outNow = now ? oToday.bankOut : outAll;                        // 今日までに出た額
    bank = { start: sb.amount, source: sb.source, state,
      current: now ? sb.amount + inNow - outNow : null,
      planned: now ? outAll - outNow : 0,          // これからの引き落とし予定
      plannedIncome: now ? inAll - inNow : 0,      // これからの入金予定
      end: sb.amount + inAll - outAll };           // 月末（期末）の見込み
  }
  const sc = startBalance_(ym, rows, st, 'cash');
  if (sc) {
    cash = { start: sc.amount, source: sc.source, state,
      current: now ? sc.amount + oToday.toCash - oToday.cash : null,
      end: sc.amount + outflow.toCash - outflow.cash - pendCash };
  }
  return { ym, period: P, custom: period.day !== 1 || period.shift !== 'none', bank, cash,
    cardDue, items, incomeCategories: st.incomeCategories, budgets: st.budgets, outflow, offBudget: st.offBudget,
    // 予算外のカテゴリがカテゴリ一覧になければ足しておく
    categories: [...new Set(st.categories.concat(st.offBudget, ['未分類']))],
    payMethods: st.payMethods.map(pm => ({ id: pm.id, name: pm.name, short: pm.short, type: pm.type })) };
}

// 記録元：mail（メール） / fixed（固定費） / manual（手入力）
function sourceOf_(id) {
  id = String(id).split('#split')[0]; // 分割した明細は元の記録元
  if (id.startsWith('fixed:')) return 'fixed';
  if (id === 'manual' || id.startsWith('manual:') || id === '') return 'manual';
  return 'mail';
}

// ===== 支払方法 =====
// 支払方法が未設定の明細の初期値（メール・固定費 → 口座、手入力 → 現金）
function defaultMethod_(source) {
  const ms = getSettings_().payMethods;
  const pick = t => (ms.find(pm => pm.type === t) || ms[0] || {}).id || '';
  // 手入力の初期値は「現金」（id: cash）。なければ最初の現金・チャージ式
  if (source === 'manual') return (ms.find(pm => pm.id === 'cash') ? 'cash' : pick('cash'));
  return pick('instant');
}
function methodType_(id, methods) {
  return ((methods || getSettings_().payMethods).find(pm => pm.id === id) || {}).type || 'instant';
}
// メールの差出人から支払方法を判定
function methodForSender_(from, methods) {
  const f = String(from || '').toLowerCase();
  const hit = methods.find(pm => (pm.senders || []).some(s => s && f.includes(String(s).toLowerCase())));
  return hit ? hit.id : defaultMethod_('mail');
}
function methodOfRow_(r) {
  if (r[8]) return String(r[8]);
  const id = String(r[5] || '');
  if (id.startsWith('fixed:')) {
    if (!fixedById_) fixedById_ = Object.fromEntries(getSettings_().fixed.map(f => [f.id, f]));
    const f = fixedById_[id.split(':')[1]];
    if (f && f.payMethod) return f.payMethod;
  }
  return defaultMethod_(sourceOf_(id));
}

// y年 m0月（0始まり）の day 日（月末を超えたら月末）
function dayOf_(y, m0, day) {
  const f = new Date(y, m0, 1);
  const ld = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate();
  return new Date(f.getFullYear(), f.getMonth(), Math.min(day, ld));
}

// カードで ds（'yyyy-MM-dd'）に使った分の引き落とし日
function cardPayDate_(ds, m) {
  const [y, mo, d] = ds.split('-').map(Number);
  let close = dayOf_(y, mo - 1, m.closeDay);
  if (ymd_(close) < ds) close = dayOf_(y, mo, m.closeDay); // 締め日を過ぎていたら次の締め
  return shiftDate_(dayOf_(close.getFullYear(), close.getMonth() + m.payOffset, m.payDay), m.shift);
}
// 日付が入る〇月度（'2026-11' の形）
function periodYmOf_(date, period) {
  const ds = ymd_(date);
  for (let off = 1; off >= -1; off--) {
    const f = new Date(date.getFullYear(), date.getMonth() + off, 1);
    const r = periodRange_(f.getFullYear(), f.getMonth() + 1, period);
    if (r.start <= ds && ds <= r.end) return ym_(f);
  }
  return ds.slice(0, 7);
}

// 期間 P の口座からの出金：即時払い＋この期間に引き落とされるカード代
// until を指定すると、その日までに実際に出ていった分だけを数える（今日の残高の計算用）
function computeOutflow_(rows, P, methods, until) {
  const today = ymd_(new Date());
  const list = rows.filter(r => r[0] && r[9] !== INCOME).map(r => ({
    ds: ymd_(new Date(r[0])), amt: Number(r[1]) || 0, mid: methodOfRow_(r),
    toCash: r[9] === TRANSFER && methodType_(String(r[3]), methods) === 'cash', // 口座 → 現金（ATM）
  }));
  let instant = 0, cash = 0, prepaid = 0, toCash = 0;
  list.forEach(x => {
    if (x.ds < P.start || x.ds > P.end || (until && x.ds > until)) return;
    if (x.toCash) { toCash += x.amt; return; } // 手元に移すだけなので出金には入れない
    const t = methodType_(x.mid, methods);
    if (t === 'cash') cash += x.amt;            // 現金：出金に含める
    else if (t === 'prepaid') prepaid += x.amt; // チャージ式：チャージしたときに出金済み
    else if (t === 'instant') instant += x.amt;
  });
  const [py, pm] = P.start.split('-').map(Number);
  const cards = [];
  methods.filter(m => m.type === 'card').forEach(m => {
    for (let k = -4; k <= 1; k++) {
      const close = dayOf_(py, pm - 1 + k, m.closeDay);          // 締め日
      const from = dayOf_(py, pm - 2 + k, m.closeDay);           // 前回の締め日
      from.setDate(from.getDate() + 1);
      const pay = shiftDate_(dayOf_(py, pm - 1 + k + m.payOffset, m.payDay), m.shift); // 引き落とし日
      const ps = ymd_(pay);
      if (ps < P.start || ps > P.end || (until && ps > until)) continue;
      const fs = ymd_(from), cs = ymd_(close);
      const amount = list.filter(x => x.mid === m.id && x.ds >= fs && x.ds <= cs).reduce((a, x) => a + x.amt, 0);
      cards.push({ method: m.id, name: m.name, payDate: ps, from: fs, to: cs, amount, closed: cs < today });
    }
  });
  const cardTotal = cards.reduce((a, c) => a + c.amount, 0);
  return { instant, cash, prepaid, toCash, cards, cardTotal, total: instant + cash + cardTotal,
    bankOut: instant + cardTotal + toCash }; // 口座から出ていく額（現金払いは除き、ATMで下ろした分を含む）
}

// ===== 口座残高 =====
const isExcluded_ = r => r[6] === false || String(r[6]).toUpperCase() === 'FALSE';
// 期間 P の入金（確定済み）。until を指定するとその日まで
function incomeOf_(rows, P, until) {
  return rows.filter(r => r[0] && r[9] === INCOME && !isExcluded_(r)).reduce((a, r) => {
    const ds = ymd_(new Date(r[0]));
    return ds >= P.start && ds <= P.end && (!until || ds <= until) ? a + (Number(r[1]) || 0) : a;
  }, 0);
}
// 〇月度の開始残高：入力があればそれ、なければ前に入力した月から入金・出金で繰り越す
// which: 'bank'（ゆうちょ） / 'cash'（手元の現金）
function startBalance_(ym, rows, st, which) {
  const bal = (which === 'cash' ? st.cashBalances : st.balances) || {};
  if (bal[ym] != null) return { amount: bal[ym], source: 'input' };
  const prev = Object.keys(bal).filter(k => k < ym).sort().pop();
  if (!prev) return null;
  let amount = bal[prev];
  let [y, m] = prev.split('-').map(Number);
  for (let i = 0; i < 120; i++) {
    if (`${y}-${String(m).padStart(2, '0')}` >= ym) break;
    const P = periodRange_(y, m, st.period);
    const o = computeOutflow_(rows, P, st.payMethods);
    amount += which === 'cash' ? o.toCash - o.cash : incomeOf_(rows, P) - o.bankOut;
    if (++m > 12) { m = 1; y++; }
  }
  return { amount, source: 'carry', from: prev };
}
// 開始残高を入力（amount が null なら入力を取り消して繰り越しに戻す）
function setStartBalance(key, ym, amount, which) {
  check_(key);
  if (!/^\d{4}-\d{2}$/.test(String(ym))) throw new Error('月の指定が正しくありません');
  const s = JSON.parse(props_().settings || '{}');
  const field = which === 'cash' ? 'cashBalances' : 'balances';
  s[field] = s[field] || {};
  if (amount === null || amount === '' || !isFinite(Number(amount))) delete s[field][ym];
  else s[field][ym] = Math.round(Number(amount));
  setProps_({ settings: JSON.stringify(s) });
  settingsMemo_ = null; fixedById_ = null;
}

// 店名が「振替として取り込む店名」に当てはまれば、振替先の支払方法IDを返す
function transferTarget_(store, st) {
  const s = norm_(store);
  const rule = (st.transferRules || []).find(t => t.match && s.includes(norm_(t.match)));
  if (!rule) return '';
  const valid = st.payMethods.filter(pm => pm.type === 'prepaid' || pm.type === 'cash');
  return (valid.find(pm => pm.id === rule.to) || valid.find(pm => pm.type === 'prepaid') || valid[0] || {}).id || '';
}

// シートの1行を画面用の明細に変換
function rowToItem_(r, row, aliases, splitBases) {
  return {
    row,
    id: String(r[5] || ''), // 明細を特定するID（行番号はずれることがあるので、操作にはこちらを使う）
    date: ymd_(new Date(r[0])),
    amount: Number(r[1]) || 0,
    // 表示する店名：明細ごとの変更 ＞ 店名の置き換え ＞ 元の店名
    rawStore: String(r[2] || ''),
    aliasStore: applyAlias_(String(r[2] || ''), aliases),
    store: String(r[7] || '') || applyAlias_(String(r[2] || ''), aliases),
    category: String(r[3] || '未分類'),
    memo: String(r[4] || ''),
    source: sourceOf_(String(r[5] || '')),
    excluded: r[6] === false || String(r[6]).toUpperCase() === 'FALSE',
    split: splitBases.has(String(r[5]).split('#split')[0]),
    group: String(r[5]).split('#split')[0],
    method: methodOfRow_(r),
    kind: r[9] === INCOME ? 'income' : r[9] === TRANSFER ? 'transfer' : 'expense',
  };
}

// 全期間から店名で検索（元の店名・置き換え後・表示店名のどれかに含まれるもの）
// カードの引き落としに含まれる明細（methodId の支払方法で、from〜to に使ったもの。入金・ATM引き出しは除く）
function getCardEntries(key, methodId, from, to) {
  check_(key);
  const sh = getSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rows = sh.getRange(2, 1, last - 1, 10).getValues();
  ensureIds_(sh, rows);
  const st = getSettings_();
  const splitBases = new Set(rows.map(r => String(r[5])).filter(id => id.includes('#split')).map(id => id.split('#split')[0]));
  const items = [];
  rows.forEach((r, i) => {
    if (!r[0] || r[9] === INCOME) return;
    if (r[9] === TRANSFER && methodType_(String(r[3]), st.payMethods) === 'cash') return;
    if (methodOfRow_(r) !== methodId) return;
    const ds = ymd_(new Date(r[0]));
    if (ds < from || ds > to) return;
    items.push(rowToItem_(r, i + 2, st.storeAlias, splitBases));
  });
  items.sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row);
  return items;
}

function searchEntries(key, q) {
  check_(key);
  const kw = norm_(q).trim();
  if (!kw) return [];
  const sh = getSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rows = sh.getRange(2, 1, last - 1, 10).getValues();
  ensureIds_(sh, rows);
  const aliases = getSettings_().storeAlias;
  const splitBases = new Set(rows.map(r => String(r[5])).filter(id => id.includes('#split')).map(id => id.split('#split')[0]));
  const items = [];
  rows.forEach((r, i) => {
    if (!r[0]) return;
    const it = rowToItem_(r, i + 2, aliases, splitBases);
    if ([it.rawStore, it.aliasStore, it.store].some(t => norm_(t).includes(kw))) items.push(it);
  });
  items.sort((a, b) => b.date.localeCompare(a.date) || a.row - b.row);
  return items.slice(0, 500);
}

function addEntry(key, e) {
  check_(key);
  const [y, m, d] = e.date.split('-').map(Number);
  if (e.kind === 'transfer') { // 口座 → 現金・チャージ式
    // 振替元はどの支払方法でもよい（口座・カード・現金・チャージ式。例：au Pay → Suica）
    const from = getSettings_().payMethods.find(pm => pm.id === e.method && pm.id !== String(e.to || 'cash'));
    getSheet_().appendRow([new Date(y, m - 1, d), Number(e.amount), e.store || '振替', String(e.to || 'cash'), e.memo || '', newManualId_(), true, '',
      from ? from.id : defaultMethod_('fixed'), TRANSFER]);
    return;
  }
  getSheet_().appendRow([new Date(y, m - 1, d), Number(e.amount), e.store || '', e.category || '未分類', e.memo || '', newManualId_(), !e.excluded, '',
    e.kind === 'income' ? defaultMethod_('fixed') : String(e.method || defaultMethod_('manual')),
    e.kind === 'income' ? INCOME : '']);
}

function updateEntry(key, entryId, category, memo, excluded, storeName, date, amount, method, kind) {
  check_(key);
  const sh = getSheet_();
  const row = rowOfId_(sh, entryId);
  const range = sh.getRange(row, 1, 1, 10);
  const r = range.getValues()[0]; // 1行をまとめて読み、最後にまとめて書く
  // 区分の変更（支出・入金・振替）。振替のときは category に振替先の支払方法ID、method に振替元が入る
  if (kind === 'expense' || kind === 'income' || kind === 'transfer') {
    r[9] = kind === 'income' ? INCOME : kind === 'transfer' ? TRANSFER : '';
    if (kind === 'transfer') excluded = false;
  }
  if (method && getSettings_().payMethods.some(pm => pm.id === method)) r[8] = method;
  // 日付・金額の変更は手入力の明細だけ
  const manual = sourceOf_(r[5]) === 'manual';
  const isIncome = r[9] === INCOME;
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if (dm && manual) r[0] = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]));
  const amt = Math.round(Number(amount));
  if ((manual || isIncome) && amt > 0) r[1] = amt; // 入金は給料など金額が変わるので変更可
  r[7] = String(storeName || '').trim(); // 空なら元の店名（置き換え）で表示
  r[3] = category;
  r[4] = memo || '';
  r[6] = !excluded;
  range.setValues([r]);
}

// ===== 明細の分割 =====
// parts: [{amount, category, memo}, ...]（合計が元の金額と同じであること）
function splitEntry(key, entryId, parts) {
  check_(key);
  const sh = getSheet_();
  const row = rowOfId_(sh, entryId);
  const r = sh.getRange(row, 1, 1, 10).getValues()[0];
  const total = Number(r[1]);
  parts = (parts || []).map(p => ({ amount: Math.round(Number(p.amount)), category: String(p.category || '未分類'), memo: String(p.memo || '') }));
  if (parts.length < 2 || parts.some(p => !(p.amount > 0))) throw new Error('分割の内容が正しくありません');
  if (parts.reduce((a, p) => a + p.amount, 0) !== total) throw new Error('合計が元の金額と一致しません');

  let baseId = String(r[5] || '').split('#split')[0];
  if (baseId === 'manual' || baseId === '') { // 古い手入力の明細はIDが共通なので、先に専用のIDを付ける
    baseId = newManualId_();
    sh.getRange(row, 6).setValue(baseId);
  }
  sh.getRange(row, 2).setValue(parts[0].amount);
  sh.getRange(row, 4).setValue(parts[0].category);
  sh.getRange(row, 5).setValue(parts[0].memo);
  parts.slice(1).forEach(p => {
    sh.appendRow([r[0], p.amount, r[2], p.category, p.memo, baseId + '#split' + Utilities.getUuid().slice(0, 8), r[6], r[7], r[8], r[9]]);
  });
}

// 手入力の明細のID（1件ごとに別のIDにする）
function newManualId_() {
  return 'manual:' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

// 以前の版で手入力の明細に共通ID「manual」を付けていたのを、1件ずつ別のIDに直す
// 分割された明細（manual#split…）は、同じ日付・同じ元の店名で一番近い前の行を分割元とみなす
function ensureIds_(sh, rows) {
  const ids = rows.map(r => String(r[5]));
  let changed = false;
  // 1. 以前の版の共通ID「manual」を1件ずつ別のIDに直す
  //    分割された明細（manual#split…）は、同じ日付・同じ元の店名で一番近い前の行を分割元とみなす
  if (ids.some(id => id === 'manual' || id.startsWith('manual#split'))) {
    const keyOf = r => (r[0] instanceof Date ? r[0].getTime() : String(r[0])) + '|' + String(r[2]);
    const renamed = new Set();
    ids.forEach((id, i) => {
      if (!id.startsWith('manual#split')) return;
      let parent = -1;
      for (let j = i - 1; j >= 0; j--) {
        if ((ids[j] === 'manual' || renamed.has(ids[j])) && keyOf(rows[j]) === keyOf(rows[i])) { parent = j; break; }
      }
      if (parent < 0) { ids[i] = newManualId_(); return; } // 分割元が見つからなければ単独の明細にする
      if (ids[parent] === 'manual') { ids[parent] = newManualId_(); renamed.add(ids[parent]); }
      ids[i] = ids[parent] + id.slice('manual'.length);
    });
    ids.forEach((id, i) => { if (id === 'manual') ids[i] = newManualId_(); });
    changed = true;
  }
  // 2. IDがない行（スプレッドシートに直接入力した行など）にIDを付け、重複したIDは付け直す
  const seen = new Set();
  ids.forEach((id, i) => {
    const blank = !rows[i][0] && !rows[i][1] && !rows[i][2];
    if (!id) { if (blank) return; ids[i] = newManualId_(); changed = true; }
    else if (seen.has(id)) { ids[i] = id + '#d' + Utilities.getUuid().slice(0, 8); changed = true; }
    seen.add(ids[i]);
  });
  if (!changed) return false;
  sh.getRange(2, 6, ids.length, 1).setValues(ids.map(x => [x]));
  ids.forEach((id, i) => { rows[i][5] = id; });
  return true;
}

// 明細のIDから、今のシートの行番号を探す（行番号は削除などでずれるので、毎回探し直す）
function rowOfId_(sh, id) {
  if (typeof id === 'number') return id; // 古い画面から行番号で来た場合
  const last = sh.getLastRow();
  const ids = last < 2 ? [] : sh.getRange(2, 6, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  throw new Error('明細が見つかりませんでした。ほかの画面やスプレッドシートで変更・削除された可能性があるので、最新の表示に更新します。');
}

// 分割をまとめて1つに戻す（カテゴリ・メモは一番上の明細のものを使う）
function unsplitEntry(key, entryId) {
  check_(key);
  const sh = getSheet_();
  const row = rowOfId_(sh, entryId);
  const last = sh.getLastRow();
  const ids = sh.getRange(2, 6, last - 1, 1).getValues().flat().map(String);
  const baseId = ids[row - 2].split('#split')[0];
  if (baseId === 'manual' || baseId === '') return; // 共通IDのままの明細はまとめない（全部まとまってしまうため）
  const rowsInGroup = ids.map((id, i) => ({ id, row: i + 2 }))
    .filter(x => x.id === baseId || x.id.startsWith(baseId + '#split'));
  if (rowsInGroup.length < 2) return;
  const keep = rowsInGroup.find(x => x.id === baseId) || rowsInGroup[0];
  const total = rowsInGroup.reduce((a, x) => a + Number(sh.getRange(x.row, 2).getValue()), 0);
  sh.getRange(keep.row, 2).setValue(total);
  sh.getRange(keep.row, 6).setValue(baseId);
  rowsInGroup.filter(x => x !== keep).map(x => x.row).sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
}

// 複数の明細のカテゴリをまとめて変更
// 固定費・定期入金のシートの1行
function fixedRow_(f, o, amount) {
  return [o.date, amount, f.name, f.category, '固定費', o.id, true, '',
    f.kind === 'income' ? defaultMethod_('fixed') : (f.payMethod || defaultMethod_('fixed')),
    f.kind === 'income' ? INCOME : ''];
}

// 確定前の固定費・定期入金を、金額を確認して今すぐ確定する（給料が入ったときなど）
function confirmFixed(key, occId, amount) {
  check_(key);
  const m = /^fixed:(.+):(\d{4})-(\d{2})$/.exec(String(occId || ''));
  if (!m) throw new Error('確定できない明細です');
  const f = getSettings_().fixed.find(x => x.id === m[1]);
  if (!f) throw new Error('固定費の設定が見つかりません');
  if (f.mode === 'mail') throw new Error('メールで確定する固定費は、メールの取り込みで確定します');
  const o = fixedOccurrence_(f, Number(m[2]), Number(m[3]) - 1);
  if (!o) throw new Error('この月は対象外です');
  const sh = getSheet_();
  const last = sh.getLastRow();
  const known = knownIds_(last < 2 ? [] : sh.getRange(2, 6, last - 1, 1).getValues().flat());
  if (known.has(o.id)) return; // すでに記録済み
  const amt = Math.round(Number(amount));
  sh.appendRow(fixedRow_(f, o, amt > 0 ? amt : f.amount));
}

function bulkCategory(key, entryIds, category) {
  check_(key);
  const sh = getSheet_();
  const last = sh.getLastRow();
  if (last < 2) return;
  // IDから今の行番号を探す（見つからないものは飛ばす）
  const want = new Set((entryIds || []).map(String));
  const ids = sh.getRange(2, 6, last - 1, 1).getValues();
  ids.forEach((v, i) => { if (want.has(String(v[0]))) sh.getRange(i + 2, 4).setValue(String(category || '未分類')); });
}

function deleteEntry(key, entryId) {
  check_(key);
  const sh = getSheet_();
  const row = rowOfId_(sh, entryId);
  const id = String(sh.getRange(row, 6).getValue());
  if (id.startsWith('fixed:')) addSkipped_(id);
  sh.deleteRow(row);
}

// 手動で今すぐ取り込み（画面の「更新」ボタン用）
// ===== 外部の画面（GitHub Pages など）から呼ぶための入口 =====
// 本文に {"fn": 関数名, "args": [...]} を送ると、結果を JSON で返す。
// 呼べるのは下の一覧の関数だけで、どれも最初の引数の合言葉を確認する。
const API_FUNCS_ = { getMonth, act, loadSettings, saveSettings, resetSettings, searchEntries, getCardEntries };
function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = API_FUNCS_[req.fn];
    if (!fn) throw new Error('不明な操作です');
    out = { ok: true, result: fn.apply(null, Array.isArray(req.args) ? req.args : []) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ===== 画面からの操作：保存して、そのまま最新の表示データを返す（やり取りを1回で済ませる） =====
const ACTIONS_ = { addEntry, updateEntry, splitEntry, unsplitEntry, confirmFixed, bulkCategory, deleteEntry, syncNow, setStartBalance, applyRulesToUncategorized };
function act(key, name, args, ym) {
  check_(key);
  const fn = ACTIONS_[name];
  if (!fn) throw new Error('不明な操作です');
  // ほかの画面やメールの取り込みと同時に書き込まないよう、順番待ちする
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    fn.apply(null, [key].concat(args || []));
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return getMonth(key, ym || 'current');
}

function syncNow(key) {
  check_(key);
  fetchCardMailsLocked_(); // act の中で順番待ち済みなので、ここでは待たない
}
