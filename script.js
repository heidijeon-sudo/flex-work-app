/* ============================================================
   유연근무 스케줄러 - 스크립트 (웹/모바일 레이아웃 동시 지원)
   ============================================================ */

'use strict';

/* ─── Constants ─────────────────────────────────────── */
const WORK_DAYS = [1, 2, 3, 4, 5];
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_NAMES_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const TARGET_HOURS = 40 * 60;        // 40h in minutes
const SHORT_THRESHOLD = 6 * 60;      // 6h in minutes
const BREAK_THRESHOLD = 8 * 60;      // 8h → 1h break, else 30m
const HOLIDAY_CREDIT = 8 * 60;       // 8h auto-credited for holiday

const DEFAULT_START = '09:30';
const DEFAULT_END = '18:30';
const STORE_KEY = 'flexSchedule_v3_responsive';

/* ─── State ──────────────────────────────────────────── */
let currentWeekOffset = 0;
let scheduleData = {}; // key: dateString → { start, end, holiday }

/* ─── Core: Time & Math ─────────────────────────────── */
function parseTime(str) {
    if (!str) return null;
    const [h, m] = str.split(':').map(Number);
    return h * 60 + m;
}

function formatMins(totalMins) {
    if (totalMins == null || isNaN(totalMins)) return '—';
    if (totalMins < 0) return '—';
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    if (m === 0) return `${h}시간`;
    return `${h}시간 ${m}분`;
}

function minsToHHMM(totalMins) {
    if (totalMins == null || isNaN(totalMins) || totalMins < 0) return null;
    const h = Math.floor(totalMins / 60) % 24;
    const m = totalMins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getBreakMins(totalWorkMins) {
    if (totalWorkMins <= 0) return 0;
    return totalWorkMins >= BREAK_THRESHOLD ? 60 : 30;
}

/* ─── Core: Dates ───────────────────────────────────── */
function getWeekDates(offset = 0) {
    const today = new Date();
    const diffToMon = (today.getDay() === 0 ? -6 : 1 - today.getDay());
    const monday = new Date(today);
    monday.setDate(today.getDate() + diffToMon + offset * 7);
    monday.setHours(0, 0, 0, 0);

    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        days.push(d);
    }
    return days;
}

function dateKey(date) { return date.toISOString().slice(0, 10); }

function isToday(date) { return date.toDateString() === new Date().toDateString(); }

function isWeekend(date) { return date.getDay() === 0 || date.getDay() === 6; }

function formatWeekRange(dates, short = false) {
    const y1 = dates[0].getFullYear(), m1 = String(dates[0].getMonth() + 1).padStart(2, '0'), d1 = String(dates[0].getDate()).padStart(2, '0');
    const y2 = dates[6].getFullYear(), m2 = String(dates[6].getMonth() + 1).padStart(2, '0'), d2 = String(dates[6].getDate()).padStart(2, '0');
    if (short) return `${y1}.${m1}.${d1} ~ ${m2}.${d2}`;
    return `${y1}. ${m1}. ${d1} ~ ${y2}. ${m2}. ${d2}`;
}

/* ─── Data Storage ──────────────────────────────────── */
function loadData() {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) scheduleData = JSON.parse(raw);
    } catch { scheduleData = {}; }
}
function saveData() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(scheduleData)); } catch { }
}

/* ─── Logic: Calculate rows & weekly summary ────────── */
function calcRow(start, end) {
    const s = parseTime(start), e = parseTime(end);
    if (s == null || e == null || e <= s) return null;
    const totalWork = e - s;
    const breakMins = getBreakMins(totalWork);
    return { totalWork, breakMins, actualWork: totalWork - breakMins };
}

function calcWeekSummary(dates) {
    let totalActual = 0, shortDayCount = 0;
    dates.forEach(date => {
        if (isWeekend(date)) return;
        const entry = scheduleData[dateKey(date)];
        if (!entry) return;
        if (entry.holiday) { totalActual += HOLIDAY_CREDIT; return; }
        if (!entry.start || !entry.end) return;
        const res = calcRow(entry.start, entry.end);
        if (!res) return;
        totalActual += res.actualWork;
        if (res.actualWork < SHORT_THRESHOLD) shortDayCount++;
    });
    return {
        totalActual,
        remaining: Math.max(0, TARGET_HOURS - totalActual),
        hasShortDay: shortDayCount > 0,
        isOver: totalActual > TARGET_HOURS
    };
}

/* Needed mins for estimate */
function neededMinsForDay(targetDate, dates) {
    let totalActual = 0, remainingDays = 0, targetKey = dateKey(targetDate);
    const today = new Date(); today.setHours(0, 0, 0, 0);

    dates.forEach(d => {
        if (isWeekend(d)) return;
        const key = dateKey(d);
        const entry = scheduleData[key] || {};
        if (entry.holiday) { totalActual += HOLIDAY_CREDIT; return; }
        const res = calcRow(entry.start, entry.end);
        const dDate = new Date(d); dDate.setHours(0, 0, 0, 0);
        if (res) { if (key !== targetKey) totalActual += res.actualWork; }
        else if (dDate >= today) { remainingDays++; }
    });
    const rem = Math.max(0, TARGET_HOURS - totalActual);
    if (remainingDays === 0) return 0;
    return Math.ceil(rem / remainingDays);
}


/* ============================================================
   [UI UPDATE CORE] 데스크탑 / 모바일 동시에 렌더링
============================================================ */
function updateAllViews() {
    const dates = getWeekDates(currentWeekOffset);

    // Date Navigators
    document.getElementById('deskWeekDisplay').textContent = formatWeekRange(dates, false);
    document.getElementById('mobWeekDisplay').textContent = formatWeekRange(dates, true);

    // 1. Build Desktop Table
    buildDesktopTable(dates);

    // 2. Build Mobile Cards
    buildMobileCards(dates);

    // 3. Update Summaries (Cards & Progress)
    const summ = calcWeekSummary(dates);
    updateDesktopSummary(summ);
    updateMobileSummary(summ);
}


/* ─── 1. Desktop UI ─────────────────────────────────── */
function buildDesktopTable(dates) {
    const tbody = document.getElementById('deskTableBody');
    tbody.innerHTML = '';

    dates.forEach(date => {
        const key = dateKey(date), entry = scheduleData[key] || {};
        const tr = document.createElement('tr');
        const isWk = isWeekend(date), isHol = !!entry.holiday, isTod = isToday(date);
        if (isWk) tr.classList.add('row-weekend');
        if (isTod) tr.classList.add('row-today');
        if (isHol) tr.classList.add('row-holiday');

        // Date
        const tdDate = document.createElement('td'); tdDate.className = 'col-date';
        tdDate.innerHTML = `<span class="date-day">${DAY_NAMES[date.getDay()]}요일</span><span class="date-sub">${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}</span>`;
        tr.appendChild(tdDate);

        // Inputs
        const createInput = (type) => {
            const td = document.createElement('td');
            const inp = document.createElement('input');
            inp.type = 'time'; inp.className = 'time-input';
            inp.value = entry[type] || '';
            inp.disabled = isWk || isHol;
            inp.addEventListener('focus', () => { if (!inp.value) { inp.value = type === 'start' ? DEFAULT_START : DEFAULT_END; handleDataChange(key, 'start', tr.querySelector('.time-input').value, 'end', tr.querySelectorAll('.time-input')[1].value); } });
            inp.addEventListener('change', (e) => handleDataChange(key, type, e.target.value));
            td.appendChild(inp); return td;
        };
        tr.appendChild(createInput('start'));
        tr.appendChild(createInput('end'));

        // Calc cells
        const cTotal = document.createElement('td'); cTotal.className = 'col-calc';
        const cBreak = document.createElement('td'); cBreak.className = 'col-calc';
        const cActual = document.createElement('td'); cActual.className = 'col-actual';
        const cEst = document.createElement('td'); cEst.className = 'col-est';

        if (isHol) {
            cTotal.textContent = '—'; cBreak.textContent = '—'; cEst.textContent = '—';
            cActual.innerHTML = `8시간 <span class="holiday-lbl">공휴일</span>`;
        } else {
            const res = calcRow(entry.start, entry.end);
            if (res) {
                cTotal.textContent = formatMins(res.totalWork);
                cBreak.textContent = formatMins(res.breakMins);
                const sht = res.actualWork < SHORT_THRESHOLD;
                cActual.innerHTML = formatMins(res.actualWork) + (sht ? '<span class="short-tag">단축</span>' : '');
                if (sht) cActual.style.color = 'var(--accent-teal)';
                cEst.textContent = '—';
            } else {
                cTotal.textContent = '—'; cBreak.textContent = '—'; cActual.textContent = '—';
                if (entry.start && !entry.end && isToday(date)) {
                    const needed = neededMinsForDay(date, dates);
                    if (needed > 0) {
                        const ed = parseTime(entry.start) + needed + (needed >= BREAK_THRESHOLD ? 60 : 30);
                        cEst.textContent = `~${minsToHHMM(ed)}`; cEst.classList.add('active');
                    } else cEst.textContent = '—';
                } else cEst.textContent = '—';
            }
        }
        tr.appendChild(cTotal); tr.appendChild(cBreak); tr.appendChild(cActual); tr.appendChild(cEst);

        // Holiday btn
        const tdHol = document.createElement('td');
        if (!isWk) {
            const btn = document.createElement('button');
            btn.className = `btn-toggle-holiday ${isHol ? 'active' : ''}`;
            btn.textContent = isHol ? '✓ 공휴일' : '설정';
            btn.onclick = () => toggleHoliday(key);
            tdHol.appendChild(btn);
        }
        tr.appendChild(tdHol);
        tbody.appendChild(tr);
    });
}

function updateDesktopSummary(summ) {
    // Cards
    const setSt = (id, val, stCls, statTxt) => {
        const card = document.getElementById(`deskCard${id}`);
        document.getElementById(`deskVal${id}`).textContent = val;
        document.getElementById(`deskStat${id}`).textContent = statTxt;
        card.className = 'desk-kpi-card'; if (stCls) card.classList.add(`status-${stCls}`);
    };

    if (summ.isOver) setSt('Total', formatMins(summ.totalActual), 'red', '초과 달성');
    else if (summ.totalActual >= TARGET_HOURS) setSt('Total', formatMins(summ.totalActual), 'green', '목표 달성');
    else setSt('Total', formatMins(summ.totalActual), 'yellow', '진행중');

    if (summ.isOver) setSt('Remain', `+${formatMins(summ.totalActual - TARGET_HOURS)}`, 'red', '초과');
    else if (summ.remaining === 0) setSt('Remain', '0시간', 'green', '완료');
    else setSt('Remain', formatMins(summ.remaining), '', '남음');

    if (summ.hasShortDay) setSt('Short', '있음', 'green', '충족');
    else setSt('Short', '없음', 'yellow', '미충족');

    const rule1 = summ.totalActual >= TARGET_HOURS && !summ.isOver, rule2 = summ.hasShortDay;
    if (rule1 && rule2) setSt('Rule', '충족', 'green', '정상');
    else if (summ.isOver) setSt('Rule', '초과 위반', 'red', '위반');
    else setSt('Rule', '미충족', (rule1 || rule2) ? 'yellow' : '', '확인 필요');

    // Progress
    const pct = (summ.totalActual / TARGET_HOURS) * 100;
    const fill = document.getElementById('deskProgressFill');
    fill.style.width = `${Math.min(pct, 100)}%`;
    fill.className = 'progress-fill';
    if (summ.isOver) fill.classList.add('over');
    document.getElementById('deskPctText').textContent = `${Math.round(Math.min(pct, 100))}%`;
}


/* ─── 2. Mobile UI ──────────────────────────────────── */
function buildMobileCards(dates) {
    const list = document.getElementById('mobCardList');
    list.innerHTML = '';

    dates.forEach(date => {
        if (isWeekend(date)) return; // Skip weekends in mobile view for cleaner UI (optional, but requested layout focuses on Mon-Fri usually. Let's show all but dim)

        const key = dateKey(date), entry = scheduleData[key] || {};
        const isWk = isWeekend(date), isHol = !!entry.holiday, isTod = isToday(date);

        // Determine if the card should be collapsed by default.
        // Let's collapse past days and weekends, but keep today and future days expanded.
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const dDate = new Date(date); dDate.setHours(0, 0, 0, 0);
        const isPast = dDate < today;
        const isCollapsed = isWk || isPast;

        const card = document.createElement('div');
        card.className = `mob-day-card ${isWk ? 'card-weekend' : ''} ${isTod ? 'card-today' : ''} ${isHol ? 'is-holiday' : ''} ${isCollapsed ? 'collapsed' : ''}`;

        // Header (Clickable for Expand/Collapse)
        const head = document.createElement('div'); head.className = 'mob-card-top';
        const badgeTxt = isWk ? (date.getDay() === 0 ? '일' : '토') : DAY_NAMES[date.getDay()];
        head.innerHTML = `
      <div class="mob-date-head-left">
        <svg class="mob-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        <div class="mob-date-info">
          <div class="mob-day-badge">${badgeTxt}요일</div>
          <div class="mob-date-full">${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}</div>
        </div>
      </div>
    `;

        // Toggle logic for Accordion
        head.onclick = (e) => {
            // Don't toggle accordion if the holiday toggle switch was clicked
            if (e.target.closest('.mob-toggle-wrap')) return;
            card.classList.toggle('collapsed');
        };

        // Holiday Toggle (Inside Header)
        if (!isWk) {
            const togWrap = document.createElement('div'); togWrap.className = 'mob-toggle-wrap';
            togWrap.innerHTML = `<span class="mob-toggle-lbl">공휴일</span><div class="mob-toggle ${isHol ? 'active' : ''}"></div>`;
            togWrap.querySelector('.mob-toggle').onclick = (e) => toggleHoliday(key);
            head.appendChild(togWrap);
        }
        card.appendChild(head);

        // Card Body (Collapsible Content)
        const bodyPanel = document.createElement('div');
        bodyPanel.className = 'mob-card-body';

        // Inputs
        const rowInp = document.createElement('div'); rowInp.className = 'mob-input-row';
        const createMobInp = (type, lbl) => {
            const grp = document.createElement('div'); grp.className = 'mob-input-group';
            const inp = document.createElement('input'); inp.type = 'time'; inp.className = 'mob-time-input';
            inp.value = entry[type] || '';
            inp.disabled = isWk || isHol;
            inp.addEventListener('focus', () => { if (!inp.value) { inp.value = type === 'start' ? DEFAULT_START : DEFAULT_END; handleDataChange(key, type, inp.value); } });
            inp.addEventListener('change', (e) => handleDataChange(key, type, e.target.value));
            grp.innerHTML = `<label>${lbl}</label>`; grp.appendChild(inp); return grp;
        };
        rowInp.appendChild(createMobInp('start', '출근 시간'));
        rowInp.appendChild(createMobInp('end', '퇴근 시간'));
        bodyPanel.appendChild(rowInp);

        // Results
        const resWrap = document.createElement('div'); resWrap.className = 'mob-calc-row';
        if (isHol) {
            resWrap.innerHTML = `<div class="mob-calc-result"><span class="big-lbl">자동 인정</span><span class="big-val">8시간 0분</span></div>`;
        } else {
            const res = calcRow(entry.start, entry.end);
            if (res) {
                resWrap.innerHTML = `
          <div class="mob-calc-item"><span class="c-lbl">총 근무시간</span><span class="c-val">${formatMins(res.totalWork)}</span></div>
          <div class="mob-calc-item"><span class="c-lbl">휴게시간</span><span class="c-val">${formatMins(res.breakMins)}</span></div>
          <div class="mob-calc-result"><span class="big-lbl">실 근무시간</span><span class="big-val" ${res.actualWork < SHORT_THRESHOLD ? 'style="color:var(--accent-teal)"' : ''}>${formatMins(res.actualWork)}</span></div>
        `;
            } else {
                resWrap.innerHTML = `<div class="mob-calc-item"><span class="c-lbl" style="opacity:0.6">입력 대기중</span></div>`;
                if (entry.start && !entry.end && isTod) {
                    const needed = neededMinsForDay(date, dates);
                    if (needed > 0) {
                        const ed = parseTime(entry.start) + needed + (needed >= BREAK_THRESHOLD ? 60 : 30);
                        const estDiv = document.createElement('div'); estDiv.className = 'est-text'; estDiv.textContent = `예상 퇴근시간 ~${minsToHHMM(ed)}`;
                        resWrap.appendChild(estDiv);
                    }
                }
            }
        }
        bodyPanel.appendChild(resWrap);

        card.appendChild(bodyPanel);
        list.appendChild(card);
    });
}

function updateMobileSummary(summ) {
    document.getElementById('mobValTotal').textContent = formatMins(summ.totalActual);
    const mCardTot = document.getElementById('mobCardTotal');
    const mDotTot = document.getElementById('mobDotTotal');

    if (summ.isOver) { mCardTot.className = 'mob-hero-card mob-over'; mDotTot.style.background = '#fff'; }
    else { mCardTot.className = 'mob-hero-card'; mDotTot.style.background = summ.totalActual >= TARGET_HOURS ? '#10a84a' : 'rgba(255,255,255,0.4)'; }

    document.getElementById('mobValRemain').textContent = summ.isOver ? '초과됨' : formatMins(summ.remaining);
    document.getElementById('mobValRemain').style.color = summ.isOver ? 'var(--status-red)' : (summ.remaining === 0 ? 'var(--status-green)' : 'var(--text-primary)');

    document.getElementById('mobValShort').textContent = summ.hasShortDay ? '있음' : '없음';
    document.getElementById('mobValShort').style.color = summ.hasShortDay ? 'var(--status-green)' : 'var(--text-primary)';

    const r1 = summ.totalActual >= TARGET_HOURS && !summ.isOver, r2 = summ.hasShortDay;
    const mobR = document.getElementById('mobValRule');
    if (r1 && r2) { mobR.textContent = '충족됨'; mobR.style.color = 'var(--status-green)'; }
    else if (summ.isOver) { mobR.textContent = '초과 위반'; mobR.style.color = 'var(--status-red)'; }
    else { mobR.textContent = '미충족'; mobR.style.color = 'var(--status-yellow)'; }

    const pct = (summ.totalActual / TARGET_HOURS) * 100;
    const mFill = document.getElementById('mobProgressFill');
    mFill.style.width = `${Math.min(pct, 100)}%`;
    mFill.className = 'progress-fill';
    if (summ.isOver) mFill.classList.add('over');
    document.getElementById('mobPctText').textContent = `${Math.round(Math.min(pct, 100))}%`;
}


/* ─── State Actions ─────────────────────────────────── */
function handleDataChange(key, field, val) {
    if (!scheduleData[key]) scheduleData[key] = {};

    // If it's a focus filling event from inputs directly modifying dom and missing args
    if (arguments.length === 5) { // fallback combo call
        scheduleData[key]['start'] = arguments[2];
        scheduleData[key]['end'] = arguments[4];
    } else {
        scheduleData[key][field] = val;
    }

    saveData(); updateAllViews();
}

function toggleHoliday(key) {
    if (!scheduleData[key]) scheduleData[key] = {};
    const isHol = !scheduleData[key].holiday;
    scheduleData[key].holiday = isHol;
    if (isHol) { scheduleData[key].start = ''; scheduleData[key].end = ''; }
    saveData(); updateAllViews();
}


/* ─── Events & Init ─────────────────────────────────── */
function bindEvents() {
    // Nav
    document.getElementById('deskPrevWeek').onclick = () => { currentWeekOffset--; updateAllViews(); };
    document.getElementById('deskNextWeek').onclick = () => { currentWeekOffset++; updateAllViews(); };
    document.getElementById('mobPrevWeek').onclick = () => { currentWeekOffset--; updateAllViews(); };
    document.getElementById('mobNextWeek').onclick = () => { currentWeekOffset++; updateAllViews(); };

    // Reset
    const resetFn = () => {
        if (!confirm('이번 주 데이터를 초기화하시겠습니까?')) return;
        getWeekDates(currentWeekOffset).forEach(d => { delete scheduleData[dateKey(d)]; });
        saveData(); updateAllViews();
    };
    document.getElementById('deskResetBtn').onclick = resetFn;
    document.getElementById('mobResetBtn').onclick = resetFn;

    // Mobile View Toggling
    document.getElementById('btnGoToInput').onclick = () => {
        document.getElementById('mobHomeView').style.display = 'none';
        document.getElementById('mobInputView').style.display = 'block';
        window.scrollTo(0, 0);
    };
    document.getElementById('btnBackHome').onclick = () => {
        document.getElementById('mobInputView').style.display = 'none';
        document.getElementById('mobHomeView').style.display = 'block';
        window.scrollTo(0, 0);
    };
}

document.addEventListener('DOMContentLoaded', () => {
    loadData();
    bindEvents();
    updateAllViews();
});
