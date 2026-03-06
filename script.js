/* ============================================================
   유연근무 스케줄러 - script.js
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
const DEFAULT_START = '09:30';       // default start time shown in suggestion
const DEFAULT_END = '18:30';       // default end time shown in suggestion

/* ─── State ──────────────────────────────────────────── */
let currentWeekOffset = 0;
let scheduleData = {}; // key: dateString → { start, end, holiday }

/* ─── Utility: time helpers ──────────────────────────── */
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

/* ─── Utility: date helpers ──────────────────────────── */
function getWeekDates(offset = 0) {
    const today = new Date();
    const day = today.getDay();
    const diffToMon = (day === 0 ? -6 : 1 - day);
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

function dateKey(date) {
    return date.toISOString().slice(0, 10);
}

function isToday(date) {
    return date.toDateString() === new Date().toDateString();
}

function isWeekend(date) {
    return date.getDay() === 0 || date.getDay() === 6;
}

function formatWeekRange(dates) {
    const fmt = (d) =>
        `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`;
    return `${fmt(dates[0])} ~ ${fmt(dates[6])}`;
}

/* ─── Storage ────────────────────────────────────────── */
const STORE_KEY = 'flexSchedule_v2';

function loadData() {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) scheduleData = JSON.parse(raw);
    } catch {
        scheduleData = {};
    }
}

function saveData() {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(scheduleData));
    } catch { /* storage full */ }
}

/* ─── Calculation ─────────────────────────────────────── */
function calcRow(start, end) {
    const s = parseTime(start);
    const e = parseTime(end);
    if (s == null || e == null) return null;
    if (e <= s) return null;
    const totalWork = e - s;
    const breakMins = getBreakMins(totalWork);
    const actualWork = totalWork - breakMins;
    return { totalWork, breakMins, actualWork };
}

function calcWeekSummary(dates) {
    let totalActual = 0;
    let shortDayCount = 0;
    let filledDays = 0;

    dates.forEach((date) => {
        if (isWeekend(date)) return;
        const key = dateKey(date);
        const entry = scheduleData[key];
        if (!entry) return;

        // Holiday: auto-credit 8h, no short-day
        if (entry.holiday) {
            filledDays++;
            totalActual += HOLIDAY_CREDIT;
            return;
        }

        if (!entry.start || !entry.end) return;
        const result = calcRow(entry.start, entry.end);
        if (!result) return;
        filledDays++;
        totalActual += result.actualWork;
        if (result.actualWork < SHORT_THRESHOLD) shortDayCount++;
    });

    const remaining = Math.max(0, TARGET_HOURS - totalActual);
    const hasShortDay = shortDayCount > 0;
    const isOver = totalActual > TARGET_HOURS;

    return { totalActual, remaining, hasShortDay, shortDayCount, isOver, filledDays };
}

/* ─── DOM: build table rows ──────────────────────────── */
function buildTable(dates) {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';

    dates.forEach((date) => {
        const key = dateKey(date);
        const entry = scheduleData[key] || {};
        const weekend = isWeekend(date);
        const today = isToday(date);
        const dayIdx = date.getDay();
        const isHoliday = !!entry.holiday;

        const tr = document.createElement('tr');
        if (weekend) tr.classList.add('is-weekend');
        if (today) tr.classList.add('is-today');
        if (isHoliday) tr.classList.add('is-holiday');
        tr.id = `row-${key}`;

        // ── Date cell ──
        const tdDate = document.createElement('td');
        tdDate.classList.add('date-cell');
        const weekdayEn = DAY_NAMES_EN[dayIdx];
        const monthDay = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
        tdDate.innerHTML = `
      <span class="date-weekday">${weekdayEn}</span>
      <span class="date-day">${weekend ? (dayIdx === 0 ? '일' : '토') : DAY_NAMES[dayIdx]}요일</span>
      <div class="date-mmdd">${monthDay}</div>
    `;
        tr.appendChild(tdDate);

        // ── Start time input ──
        const tdStart = document.createElement('td');
        const startInput = document.createElement('input');
        startInput.type = 'time';
        startInput.className = 'time-input';
        startInput.id = `start-${key}`;
        startInput.value = entry.start || '';
        startInput.disabled = weekend || isHoliday;
        startInput.setAttribute('aria-label', `${monthDay} 출근시간`);
        tdStart.appendChild(startInput);
        tr.appendChild(tdStart);

        // ── End time input ──
        const tdEnd = document.createElement('td');
        const endInput = document.createElement('input');
        endInput.type = 'time';
        endInput.className = 'time-input';
        endInput.id = `end-${key}`;
        endInput.value = entry.end || '';
        endInput.disabled = weekend || isHoliday;
        endInput.setAttribute('aria-label', `${monthDay} 퇴근시간`);
        tdEnd.appendChild(endInput);
        tr.appendChild(tdEnd);

        // ── Calc cells ──
        const tdTotal = document.createElement('td');
        tdTotal.classList.add('calc-cell');
        tdTotal.id = `total-${key}`;
        tdTotal.textContent = '—';
        tr.appendChild(tdTotal);

        const tdBreak = document.createElement('td');
        tdBreak.classList.add('calc-cell');
        tdBreak.id = `break-${key}`;
        tdBreak.textContent = '—';
        tr.appendChild(tdBreak);

        const tdActual = document.createElement('td');
        tdActual.classList.add('actual-cell');
        tdActual.id = `actual-${key}`;
        tdActual.textContent = '—';
        tr.appendChild(tdActual);

        // ── Est end time ──
        const tdEst = document.createElement('td');
        tdEst.classList.add('est-cell');
        tdEst.id = `est-${key}`;
        tdEst.textContent = '—';
        tr.appendChild(tdEst);

        // ── Holiday toggle ──
        const tdHoliday = document.createElement('td');
        tdHoliday.classList.add('holiday-cell');
        if (!weekend) {
            const btn = document.createElement('button');
            btn.className = `holiday-btn${isHoliday ? ' active' : ''}`;
            btn.id = `holiday-${key}`;
            btn.title = isHoliday ? '공휴일 해제' : '공휴일로 설정';
            btn.innerHTML = isHoliday
                ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg> 공휴일`
                : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
            btn.addEventListener('click', () => toggleHoliday(key, date, dates));
            tdHoliday.appendChild(btn);
        }
        tr.appendChild(tdHoliday);

        tbody.appendChild(tr);

        // ── Event listeners for time change ──
        const handleChange = () => {
            if (!scheduleData[key]) scheduleData[key] = {};
            scheduleData[key].start = startInput.value;
            scheduleData[key].end = endInput.value;
            saveData();
            updateRow(key, date);
            updateSummary(dates);
        };

        // Focus: set default if empty AND immediately trigger calculation
        startInput.addEventListener('focus', () => {
            if (!startInput.value) {
                startInput.value = DEFAULT_START;
                handleChange();
            }
        });
        endInput.addEventListener('focus', () => {
            if (!endInput.value) {
                endInput.value = DEFAULT_END;
                handleChange();
            }
        });

        startInput.addEventListener('change', handleChange);
        endInput.addEventListener('change', handleChange);

        // Initial render
        updateRow(key, date);
    });
}

/* ─── Toggle holiday ─────────────────────────────────── */
function toggleHoliday(key, date, dates) {
    if (!scheduleData[key]) scheduleData[key] = {};
    const isHoliday = !scheduleData[key].holiday;
    scheduleData[key].holiday = isHoliday;
    if (isHoliday) {
        // Clear time inputs when marking as holiday
        scheduleData[key].start = '';
        scheduleData[key].end = '';
    }
    saveData();

    // Update row UI
    const tr = document.getElementById(`row-${key}`);
    const startInput = document.getElementById(`start-${key}`);
    const endInput = document.getElementById(`end-${key}`);
    const btn = document.getElementById(`holiday-${key}`);

    if (isHoliday) {
        tr.classList.add('is-holiday');
        startInput.value = '';
        endInput.value = '';
        startInput.disabled = true;
        endInput.disabled = true;
        btn.classList.add('active');
        btn.title = '공휴일 해제';
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg> 공휴일`;
    } else {
        tr.classList.remove('is-holiday');
        startInput.disabled = false;
        endInput.disabled = false;
        btn.classList.remove('active');
        btn.title = '공휴일로 설정';
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
    }

    updateRow(key, date);
    updateSummary(dates);
}

/* ─── Update a single row's calculated cells ─────────── */
function updateRow(key, date) {
    const entry = scheduleData[key] || {};
    const tdTotal = document.getElementById(`total-${key}`);
    const tdBreak = document.getElementById(`break-${key}`);
    const tdActual = document.getElementById(`actual-${key}`);
    const tdEst = document.getElementById(`est-${key}`);
    if (!tdTotal) return;

    // Holiday row
    if (entry.holiday) {
        tdTotal.textContent = '—';
        tdBreak.textContent = '—';
        tdActual.innerHTML = `8시간 <span class="holiday-chip">공휴일</span>`;
        tdActual.classList.remove('short-day');
        tdEst.textContent = '—';
        tdEst.classList.remove('available');
        return;
    }

    const result = calcRow(entry.start, entry.end);

    if (result) {
        tdTotal.textContent = formatMins(result.totalWork);
        tdBreak.textContent = formatMins(result.breakMins);
        const isShort = result.actualWork < SHORT_THRESHOLD;
        tdActual.innerHTML = formatMins(result.actualWork) +
            (isShort ? '<span class="short-chip">단축</span>' : '');
        tdActual.classList.toggle('short-day', isShort);
        tdEst.textContent = '—';
        tdEst.classList.remove('available');
    } else {
        tdTotal.textContent = '—';
        tdBreak.textContent = '—';
        tdActual.textContent = '—';
        tdActual.classList.remove('short-day');

        // Estimate end time: if start entered but no end, and is today
        if (entry.start && !entry.end && isToday(date)) {
            const startMins = parseTime(entry.start);
            const needed = neededMinsForDay(date);
            if (needed != null && needed > 0) {
                const estEnd = startMins + needed + (needed >= BREAK_THRESHOLD ? 60 : 30);
                const estStr = minsToHHMM(estEnd);
                tdEst.textContent = estStr ? `~${estStr}` : '—';
                tdEst.classList.add('available');
            } else {
                tdEst.textContent = '—';
                tdEst.classList.remove('available');
            }
        } else {
            tdEst.textContent = '—';
            tdEst.classList.remove('available');
        }
    }
}

/* ─── Needed minutes for today ───────────────────────── */
function neededMinsForDay(targetDate) {
    const dates = getWeekDates(currentWeekOffset);
    let totalActual = 0;
    let remainingDays = 0;
    const targetKey = dateKey(targetDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    dates.forEach((d) => {
        if (isWeekend(d)) return;
        const key = dateKey(d);
        const entry = scheduleData[key] || {};
        if (entry.holiday) {
            totalActual += HOLIDAY_CREDIT;
            return;
        }
        const result = calcRow(entry.start, entry.end);
        const dDate = new Date(d);
        dDate.setHours(0, 0, 0, 0);
        if (result) {
            if (key !== targetKey) totalActual += result.actualWork;
        } else if (dDate >= today) {
            remainingDays++;
        }
    });

    const remaining = Math.max(0, TARGET_HOURS - totalActual);
    if (remainingDays === 0) return 0;
    return Math.ceil(remaining / remainingDays);
}

/* ─── Summary cards & progress ───────────────────────── */
function updateSummary(dates) {
    const { totalActual, remaining, hasShortDay, isOver } = calcWeekSummary(dates);

    // Total actual
    const elTotal = document.getElementById('totalActual');
    const cardTotal = document.getElementById('card-total');
    const badgeTotal = document.getElementById('badge-total');
    elTotal.textContent = formatMins(totalActual);
    if (isOver) setCardStatus(cardTotal, badgeTotal, 'red', '초과');
    else if (totalActual >= TARGET_HOURS) setCardStatus(cardTotal, badgeTotal, 'green', '달성');
    else if (totalActual >= TARGET_HOURS * 0.7) setCardStatus(cardTotal, badgeTotal, 'yellow', '진행중');
    else setCardStatus(cardTotal, badgeTotal, null, '—');

    // Remaining
    const elRemain = document.getElementById('remainHours');
    const cardRemain = document.getElementById('card-remain');
    const badgeRemain = document.getElementById('badge-remain');
    if (isOver) {
        elRemain.textContent = `+${formatMins(totalActual - TARGET_HOURS)} 초과`;
        setCardStatus(cardRemain, badgeRemain, 'red', '초과');
    } else {
        elRemain.textContent = formatMins(remaining);
        if (remaining === 0) setCardStatus(cardRemain, badgeRemain, 'green', '완료');
        else if (remaining < TARGET_HOURS * 0.3) setCardStatus(cardRemain, badgeRemain, 'yellow', '거의 완료');
        else setCardStatus(cardRemain, badgeRemain, null, '—');
    }

    // Short day
    const elShort = document.getElementById('shortDayStatus');
    const cardShort = document.getElementById('card-short');
    const badgeShort = document.getElementById('badge-short');
    if (hasShortDay) {
        elShort.textContent = '있음 ✓';
        setCardStatus(cardShort, badgeShort, 'green', '충족');
    } else {
        elShort.textContent = '없음';
        setCardStatus(cardShort, badgeShort, 'yellow', '미충족');
    }

    // Rule
    const elRule = document.getElementById('ruleStatus');
    const cardRule = document.getElementById('card-rule');
    const badgeRule = document.getElementById('badge-rule');
    const rule1 = totalActual >= TARGET_HOURS && !isOver;
    const rule2 = hasShortDay;
    if (rule1 && rule2) { elRule.textContent = '충족 ✓'; setCardStatus(cardRule, badgeRule, 'green', '충족'); }
    else if (isOver) { elRule.textContent = '초과!'; setCardStatus(cardRule, badgeRule, 'red', '위반'); }
    else { elRule.textContent = '미충족'; setCardStatus(cardRule, badgeRule, rule1 || rule2 ? 'yellow' : null, '미충족'); }

    // Progress bar
    const pct = (totalActual / TARGET_HOURS) * 100;
    const fill = document.getElementById('progressFill');
    const pctLabel = document.getElementById('progressPercent');
    fill.style.width = `${Math.min(pct, 100)}%`;
    fill.className = 'progress-bar-fill';
    if (isOver) fill.classList.add('over');
    else if (pct >= 80) fill.classList.add('near');
    pctLabel.textContent = `${Math.round(Math.min(pct, 100))}%`;

    updateSuggestion(dates, remaining);
}

function setCardStatus(card, badge, status, label) {
    card.className = 'summary-card';
    if (status) card.classList.add(`status-${status}`);
    badge.textContent = label;
}

/* ─── Suggestion section ─────────────────────────────── */
function updateSuggestion(dates, remaining) {
    const section = document.getElementById('suggestionSection');
    const body = document.getElementById('suggestionBody');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const remainingDays = dates.filter((d) => {
        if (isWeekend(d)) return false;
        const dDate = new Date(d);
        dDate.setHours(0, 0, 0, 0);
        if (dDate < today) return false;
        const key = dateKey(d);
        const entry = scheduleData[key] || {};
        if (entry.holiday) return false;
        return !(entry.start && entry.end && calcRow(entry.start, entry.end));
    });

    if (remaining <= 0 || remainingDays.length === 0) {
        section.classList.remove('visible');
        return;
    }

    section.classList.add('visible');
    const perDay = Math.ceil(remaining / remainingDays.length);
    const startDefault = parseTime(DEFAULT_START);

    body.innerHTML = remainingDays.map((d) => {
        const dayName = DAY_NAMES[d.getDay()] + '요일';
        const breakMins = perDay >= BREAK_THRESHOLD ? 60 : 30;
        const estEnd = minsToHHMM(startDefault + perDay + breakMins);
        return `<div class="suggest-chip">
      <span class="suggest-day">${dayName}</span>
      ${formatMins(perDay)} 필요
      ${estEnd ? `<span style="color:var(--text-muted)">→ ${DEFAULT_START} 출근 시 ~${estEnd} 퇴근</span>` : ''}
    </div>`;
    }).join('');
}

/* ─── Init ───────────────────────────────────────────── */
function renderWeek() {
    const dates = getWeekDates(currentWeekOffset);
    document.getElementById('weekDisplay').textContent = formatWeekRange(dates);
    document.getElementById('weekLabel').textContent =
        currentWeekOffset === 0 ? '이번 주 근무 현황'
            : currentWeekOffset < 0 ? `${Math.abs(currentWeekOffset)}주 전 근무 현황`
                : `${currentWeekOffset}주 후 근무 현황`;

    buildTable(dates);
    updateSummary(dates);
}

function init() {
    loadData();
    document.getElementById('prevWeekBtn').addEventListener('click', () => { currentWeekOffset--; renderWeek(); });
    document.getElementById('nextWeekBtn').addEventListener('click', () => { currentWeekOffset++; renderWeek(); });
    document.getElementById('resetBtn').addEventListener('click', () => {
        if (!confirm('이번 주 데이터를 초기화하겠습니까?')) return;
        getWeekDates(currentWeekOffset).forEach((d) => { delete scheduleData[dateKey(d)]; });
        saveData();
        renderWeek();
    });
    renderWeek();
}

document.addEventListener('DOMContentLoaded', init);
