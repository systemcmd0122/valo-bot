
// グローバル変数
let currentUser = null;
let schedules = [];
let scheduleModal = null;
let dateTimePicker = null;
let currentFilter = 'upcoming';

// DOM読み込み後の初期化
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initializeApp();
    } catch (error) {
        console.error('アプリケーション初期化エラー:', error);
        showError('アプリケーションの初期化に失敗しました。ページを再読み込みしてください。');
    }
});

// アプリケーション初期化
async function initializeApp() {
    // 認証状態確認
    const authStatus = await checkAuthStatus();
    if (!authStatus.authenticated) {
        window.location.href = '/';
        return;
    }

    currentUser = authStatus.user;
    document.getElementById('username').textContent = currentUser.username;

    // UI初期化
    initializeEventListeners();
    initializeDateTimePicker();
    initializeModal();

    // スケジュール読み込み
    await loadSchedules();
}

// 認証状態確認
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/auth/status');
        return await response.json();
    } catch (error) {
        console.error('認証状態確認エラー:', error);
        return { authenticated: false };
    }
}

// イベントリスナー初期化
function initializeEventListeners() {
    // ログアウトボタン
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
            window.location.href = '/';
        } catch (error) {
            console.error('ログアウトエラー:', error);
            alert('ログアウトに失敗しました。');
        }
    });

    // 新規スケジュール作成ボタン
    document.getElementById('newScheduleBtn').addEventListener('click', () => {
        openModal();
    });

    // フィルタータブ
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            setActiveFilter(e.target.dataset.filter);
        });
    });

    // モーダル閉じるボタン
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
        btn.addEventListener('click', closeModal);
    });

    // モーダル外クリックで閉じる
    document.getElementById('scheduleModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            closeModal();
        }
    });

    // ESCキーでモーダルを閉じる
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && scheduleModal && scheduleModal.open) {
            closeModal();
        }
    });

    // フォーム送信
    document.getElementById('scheduleForm').addEventListener('submit', handleFormSubmit);
}

// 日時ピッカー初期化
function initializeDateTimePicker() {
    const dateTimeInput = document.getElementById('dateTime');
    const calendarTrigger = document.querySelector('.calendar-trigger');

    dateTimePicker = flatpickr(dateTimeInput, {
        enableTime: true,
        dateFormat: "Y-m-d H:i",
        time_24hr: true,
        locale: "ja",
        minDate: "today",
        defaultHour: new Date().getHours() + 1,
        defaultMinute: 0,
        position: 'auto',
        showMonths: 1,
        animate: true,
        nextArrow: `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 18l6-6-6-6"/>
            </svg>
        `,
        prevArrow: `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 18l-6-6 6-6"/>
            </svg>
        `,
        onChange: function(selectedDates, dateStr) {
            const now = new Date();
            if (selectedDates[0] < now) {
                dateTimeInput.parentElement.classList.add('error');
                showFormError('過去の日時は選択できません。', dateTimeInput);
                dateTimePicker.clear();
                return;
            }
            dateTimeInput.parentElement.classList.remove('error');
            clearFormErrors();
        },
        onOpen: function() {
            dateTimeInput.parentElement.classList.add('calendar-open');
        },
        onClose: function() {
            dateTimeInput.parentElement.classList.remove('calendar-open');
        }
    });

    // カレンダーアイコンクリックでも開けるように
    calendarTrigger.addEventListener('click', () => {
        dateTimePicker.open();
    });
}

// モーダル初期化
function initializeModal() {
    scheduleModal = document.getElementById('scheduleModal');
}

// モーダルを開く
function openModal() {
    if (scheduleModal) {
        document.getElementById('scheduleForm').reset();
        clearFormErrors();
        scheduleModal.showModal();
        
        // フォーカスをタイトル入力欄に設定
        setTimeout(() => {
            document.getElementById('title').focus();
        }, 100);
    }
}

// モーダルを閉じる
function closeModal() {
    if (scheduleModal && scheduleModal.open) {
        scheduleModal.close();
        clearFormErrors();
    }
}

// フィルター設定
function setActiveFilter(filter) {
    currentFilter = filter;
    
    // タブのアクティブ状態更新
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-filter="${filter}"]`).classList.add('active');
    
    // スケジュール表示更新
    renderSchedules();
}

// スケジュール読み込み
async function loadSchedules() {
    try {
        showLoading();
        const response = await fetch('/api/schedules');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        schedules = await response.json();
        renderSchedules();
    } catch (error) {
        console.error('スケジュール読み込みエラー:', error);
        showError('スケジュールの読み込みに失敗しました。');
    }
}

// スケジュール表示
function renderSchedules() {
    const container = document.getElementById('scheduleList');
    const filteredSchedules = getFilteredSchedules();
    
    if (filteredSchedules.length === 0) {
        container.innerHTML = `
            <div class="no-schedules">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <h3>スケジュールがありません</h3>
                <p>新規ミッションボタンから最初のスケジュールを作成してください。</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    filteredSchedules.forEach(schedule => {
        const cardElement = createScheduleCard(schedule);
        container.appendChild(cardElement);
    });
}

// フィルター済みスケジュール取得
function getFilteredSchedules() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    
    let filtered = schedules.filter(schedule => new Date(schedule.dateTime) > now);
    
    switch (currentFilter) {
        case 'today':
            const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000);
            filtered = filtered.filter(schedule => {
                const scheduleDate = new Date(schedule.dateTime);
                return scheduleDate >= today && scheduleDate < todayEnd;
            });
            break;
        case 'tomorrow':
            const tomorrowEnd = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000);
            filtered = filtered.filter(schedule => {
                const scheduleDate = new Date(schedule.dateTime);
                return scheduleDate >= tomorrow && scheduleDate < tomorrowEnd;
            });
            break;
        case 'my':
            filtered = filtered.filter(schedule => 
                schedule.participants.includes(currentUser.discordId)
            );
            break;
        case 'upcoming':
        default:
            // すでにフィルター済み（未来のスケジュール）
            break;
    }
    
    return filtered.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
}

// スケジュールカード作成
function createScheduleCard(schedule) {
    const template = document.getElementById('scheduleCardTemplate');
    const card = template.content.cloneNode(true);
    const scheduleDate = new Date(schedule.dateTime);
    const now = new Date();
    
    const isCreator = schedule.createdById === currentUser.discordId;
    const isParticipant = schedule.participants.includes(currentUser.discordId);
    const isAbsent = schedule.absentees.includes(currentUser.discordId);
    const isPast = scheduleDate <= now;
    
    // カード内容の設定
    card.querySelector('.title').textContent = schedule.title;
    card.querySelector('.type-badge').textContent = schedule.type;
    card.querySelector('.datetime').textContent = formatDateTime(scheduleDate);
    card.querySelector('.description').textContent = schedule.description || '詳細なし';
    
    // 参加者数表示
    const participantCount = card.querySelector('.count');
    participantCount.textContent = `参加: ${schedule.participants.length}人 / 不参加: ${schedule.absentees.length}人`;
    
    // 参加者リストをツールチップに表示
    if (schedule.participants.length > 0) {
        const participantsList = schedule.participants.map(id => {
            const isCreatorParticipant = id === schedule.createdById;
            return `${id}${isCreatorParticipant ? ' (作成者)' : ''}`;
        }).join('\n');
        participantCount.title = `参加者:\n${participantsList}`;
    } else {
        participantCount.title = '参加者なし';
    }
    
    // 参加ステータス表示
    const statusText = isCreator ? '作成者' : 
                     isParticipant ? '参加予定' :
                     isAbsent ? '不参加' : '未回答';
    card.querySelector('.participation-status').textContent = statusText;
    
    // ボタンの設定
    const joinBtn = card.querySelector('.join-btn');
    const cancelBtn = card.querySelector('.cancel-btn');
    
    if (isPast) {
        joinBtn.disabled = true;
        cancelBtn.disabled = true;
        joinBtn.title = '開始時刻を過ぎているため参加できません';
        cancelBtn.title = '開始時刻を過ぎているためキャンセルできません';
        joinBtn.textContent = '終了済み';
        cancelBtn.textContent = '終了済み';
    } else {
        joinBtn.disabled = isParticipant;
        cancelBtn.disabled = !isParticipant;
        
        if (isParticipant) {
            joinBtn.title = '既に参加予定です';
        }
        
        // ボタンイベント
        joinBtn.addEventListener('click', () => joinSchedule(schedule.id));
        cancelBtn.addEventListener('click', () => cancelSchedule(schedule.id));
    }
    
    return card;
}

// 日時フォーマット
function formatDateTime(date) {
    return date.toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short'
    });
}

// スケジュール参加
async function joinSchedule(scheduleId) {
    try {
        const response = await fetch(`/api/schedules/${scheduleId}/join`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error('参加に失敗しました');
        }
        
        await loadSchedules();
        showSuccess('ミッションに参加しました！');
    } catch (error) {
        console.error('参加エラー:', error);
        showError('参加に失敗しました。もう一度お試しください。');
    }
}

// スケジュール参加キャンセル
async function cancelSchedule(scheduleId) {
    try {
        const response = await fetch(`/api/schedules/${scheduleId}/cancel`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error('キャンセルに失敗しました');
        }
        
        await loadSchedules();
        showSuccess('参加をキャンセルしました。');
    } catch (error) {
        console.error('キャンセルエラー:', error);
        showError('キャンセルに失敗しました。もう一度お試しください。');
    }
}

// フォーム送信処理
async function handleFormSubmit(e) {
    e.preventDefault();
    clearFormErrors();
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const formData = new FormData(e.target);
    const dateTime = dateTimePicker.selectedDates[0];
    
    // バリデーション
    if (!validateForm(formData, dateTime)) {
        return;
    }
    
    // 送信処理
    try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
            <div class="loading-spinner"></div>
            <span>作成中...</span>
        `;
        
        const scheduleData = {
            title: formData.get('title').trim(),
            type: formData.get('type'),
            dateTime: dateTime.toISOString(),
            description: formData.get('description')?.trim() || ''
        };
        
        const response = await fetch('/api/schedules', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(scheduleData)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'スケジュールの作成に失敗しました');
        }
        
        showSuccess('ミッションが正常に作成されました！');
        closeModal();
        await loadSchedules();
        
    } catch (error) {
        console.error('スケジュール作成エラー:', error);
        showFormError(error.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
            <span>ミッション作成</span>
            <div class="btn-glow"></div>
        `;
    }
}

// フォームバリデーション
function validateForm(formData, dateTime) {
    const title = formData.get('title')?.trim();
    const type = formData.get('type');
    
    if (!title) {
        showFormError('ミッションタイトルは必須です。', document.getElementById('title'));
        return false;
    }
    
    if (title.length > 100) {
        showFormError('ミッションタイトルは100文字以内で入力してください。', document.getElementById('title'));
        return false;
    }
    
    if (!type) {
        showFormError('ミッション種別を選択してください。', document.getElementById('type'));
        return false;
    }
    
    if (!dateTime) {
        showFormError('ミッション日時を選択してください。', document.getElementById('dateTime'));
        return false;
    }
    
    if (dateTime <= new Date()) {
        showFormError('過去の日時は選択できません。', document.getElementById('dateTime'));
        return false;
    }
    
    return true;
}

// フォームエラー表示
function showFormError(message, field = null) {
    const formError = document.querySelector('.form-error');
    if (formError) {
        formError.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            ${message}
        `;
        
        if (field) {
            const formGroup = field.closest('.form-group');
            formGroup.classList.add('error');
            field.setAttribute('aria-invalid', 'true');
            field.focus();
            formGroup.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

// フォームエラークリア
function clearFormErrors() {
    const formError = document.querySelector('.form-error');
    if (formError) {
        formError.textContent = '';
    }
    
    document.querySelectorAll('.form-group.error').forEach(group => {
        group.classList.remove('error');
        const input = group.querySelector('input, select, textarea');
        if (input) {
            input.removeAttribute('aria-invalid');
        }
    });
}

// ローディング表示
function showLoading() {
    const container = document.getElementById('scheduleList');
    container.innerHTML = `
        <div class="loading-state">
            <div class="loading-spinner"></div>
            <h3>スケジュールを読み込み中...</h3>
            <p>しばらくお待ちください。</p>
        </div>
    `;
}

// エラー表示
function showError(message) {
    const container = document.getElementById('scheduleList');
    container.innerHTML = `
        <div class="error-message">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <h3>エラーが発生しました</h3>
            <p>${message}</p>
            <button onclick="location.reload()" class="btn-primary">
                ページを再読み込み
            </button>
        </div>
    `;
}

// 成功メッセージ表示
function showSuccess(message) {
    // 簡単な成功通知（ここでは一時的なトーストを実装）
    const toast = document.createElement('div');
    toast.className = 'toast success';
    toast.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
        </svg>
        ${message}
    `;
    
    // トーストのスタイルを追加
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--valo-green);
        color: var(--valo-black);
        padding: 1rem 1.5rem;
        border-radius: var(--border-radius);
        box-shadow: var(--shadow-heavy);
        z-index: 1000;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: 600;
        animation: slideIn 0.3s ease-out;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-in forwards';
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 3000);
}

// アニメーション用CSS
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);
