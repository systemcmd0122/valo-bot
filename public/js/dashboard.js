// グローバル変数
let currentUser = null;
let schedules = [];
let scheduleForm = null;
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

    // スケジュールフォーム初期化
    scheduleForm = new ScheduleForm();
    scheduleForm.form.addEventListener('scheduleCreated', handleScheduleCreated);

    // UI初期化
    initializeEventListeners();

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
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // 新規スケジュール作成ボタン
    document.getElementById('newScheduleBtn').addEventListener('click', () => {
        document.getElementById('scheduleModal').showModal();
    });

    // フィルタータブ
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            setActiveFilter(e.target.dataset.filter);
        });
    });

    // モーダル閉じるボタン
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('scheduleModal').close();
        });
    });

    // モーダル外クリックで閉じる
    document.getElementById('scheduleModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            e.target.close();
        }
    });

    // ESCキーでモーダルを閉じる
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('scheduleModal');
            if (modal.open) {
                modal.close();
            }
        }
    });
}

// スケジュール作成完了ハンドラ
async function handleScheduleCreated(event) {
    const response = event.detail;
    if (response.success) {
        schedules = response.schedules; // サーバーから返された最新のスケジュール一覧で更新
        document.getElementById('scheduleModal').close();
        await renderSchedules();
        showSuccessMessage('新しいミッションが作成されました！');
    } else {
        showError(response.error || 'ミッションの作成に失敗しました。');
    }
}

// ログアウト処理
async function handleLogout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/';
    } catch (error) {
        console.error('ログアウトエラー:', error);
        showError('ログアウトに失敗しました。');
    }
}

// フィルター設定
function setActiveFilter(filter) {
    currentFilter = filter;
    
    // タブのアクティブ状態更新
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.filter === filter);
    });
    
    // スケジュール表示更新
    renderSchedules();
}

// スケジュール読み込み
async function loadSchedules() {
    try {
        showLoading();
        const response = await fetch('/api/schedules?' + new URLSearchParams({
            _: Date.now(), // キャッシュ防止
            all: 'false'  // 未来の予定のみを取得
        }));
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.success) {
            schedules = Array.isArray(data.schedules) ? data.schedules : [];
            await renderSchedules();
        } else {
            throw new Error(data.error || 'スケジュールの読み込みに失敗しました');
        }
    } catch (error) {
        console.error('スケジュール読み込みエラー:', error);
        showError('スケジュールの読み込みに失敗しました。ページを再読み込みしてください。');
        
        // 空の配列で初期化して表示を更新
        schedules = [];
        await renderSchedules();
    } finally {
        hideLoading();
    }
}

// スケジュール表示
async function renderSchedules() {
    const container = document.getElementById('scheduleList');
    container.innerHTML = '';

    const now = new Date();
    const filteredSchedules = filterSchedules(schedules, currentFilter, now);
    
    if (filteredSchedules.length === 0) {
        container.innerHTML = '<div class="no-schedules">スケジュールがありません</div>';
        return;
    }

    for (const schedule of filteredSchedules) {
        const card = await createScheduleCard(schedule);
        container.appendChild(card);
    }
}

// スケジュールフィルタリング
function filterSchedules(schedules, filter, now) {
    if (!Array.isArray(schedules)) {
        console.error('Invalid schedules data:', schedules);
        return [];
    }

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(tomorrow.getDate() + 1);
    
    return schedules.filter(schedule => {
        try {
            const scheduleDate = new Date(schedule.dateTime);
            if (isNaN(scheduleDate.getTime())) {
                console.error('Invalid date:', schedule.dateTime);
                return false;
            }

            switch (filter) {
                case 'today':
                    return scheduleDate >= today && scheduleDate < tomorrow;
                case 'tomorrow':
                    return scheduleDate >= tomorrow && scheduleDate < dayAfterTomorrow;
                case 'my':
                    return schedule.participants && 
                           Array.isArray(schedule.participants) && 
                           schedule.participants.includes(currentUser.discordId);
                case 'upcoming':
                default:
                    return scheduleDate >= now;
            }
        } catch (error) {
            console.error('Error filtering schedule:', error);
            return false;
        }
    }).sort((a, b) => {
        try {
            return new Date(a.dateTime) - new Date(b.dateTime);
        } catch (error) {
            console.error('Error sorting schedules:', error);
            return 0;
        }
    });
}

// スケジュールカードの作成
async function createScheduleCard(schedule) {
    const template = document.getElementById('scheduleCardTemplate');
    const card = template.content.cloneNode(true).children[0];
    
    try {
        // タイトルと種類を設定
        card.querySelector('.title').textContent = schedule.title;
        card.querySelector('.type-badge').textContent = schedule.type;
        
        // 日時を設定
        const datetime = new Date(schedule.dateTime);
        if (isNaN(datetime.getTime())) {
            throw new Error('Invalid datetime');
        }
        card.querySelector('.datetime').textContent = formatDateTime(datetime);
        
        // 説明を設定
        const description = card.querySelector('.description');
        description.textContent = schedule.description || '説明はありません';
        
        // 参加状態を設定
        const isParticipating = schedule.participants.includes(currentUser.discordId);
        const participationStatus = card.querySelector('.participation-status');
        participationStatus.textContent = isParticipating ? '✅ 参加予定' : '';
        
        // 参加者数を設定
        const agentsCount = card.querySelector('.agents-count');
        agentsCount.textContent = `参加者: ${schedule.participants.length}人`;
        
        // ボタンの状態を設定
        const joinBtn = card.querySelector('.join-btn');
        const cancelBtn = card.querySelector('.cancel-btn');
        
        if (isParticipating) {
            joinBtn.style.display = 'none';
            cancelBtn.style.display = 'block';
        } else {
            joinBtn.style.display = 'block';
            cancelBtn.style.display = 'none';
        }
        
        // ボタンのイベントリスナーを設定
        joinBtn.addEventListener('click', async () => {
            try {
                const response = await fetch(`/api/schedules/${schedule.id}/join`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (!response.ok) {
                    throw new Error('参加に失敗しました');
                }
                
                await loadSchedules();
                showSuccessMessage('参加を表明しました！');
            } catch (error) {
                console.error('参加エラー:', error);
                showError('参加の処理に失敗しました。');
            }
        });
        
        cancelBtn.addEventListener('click', async () => {
            try {
                const response = await fetch(`/api/schedules/${schedule.id}/cancel`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (!response.ok) {
                    throw new Error('キャンセルに失敗しました');
                }
                
                await loadSchedules();
                showSuccessMessage('参加をキャンセルしました。');
            } catch (error) {
                console.error('キャンセルエラー:', error);
                showError('キャンセルの処理に失敗しました。');
            }
        });
        
        return card;
    } catch (error) {
        console.error('スケジュールカード作成エラー:', error);
        const errorCard = document.createElement('div');
        errorCard.className = 'schedule-card error';
        errorCard.textContent = 'スケジュールの表示に失敗しました';
        return errorCard;
    }
}

// 日時のフォーマット
function formatDateTime(date) {
    const options = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Tokyo'
    };
    return date.toLocaleString('ja-JP', options);
}

// UI要素表示/非表示
function showLoading() {
    document.getElementById('scheduleList').classList.add('loading');
}

function hideLoading() {
    document.getElementById('scheduleList').classList.remove('loading');
}

// 通知メッセージ表示
function showNotification(message, type = 'success') {
    // 既存の通知を削除
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    // 新しい通知を作成
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span class="notification-message">${message}</span>
        <button class="notification-close">×</button>
    `;

    // 通知を表示
    document.body.appendChild(notification);

    // クローズボタンの処理
    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => notification.remove());

    // 5秒後に自動で消える
    setTimeout(() => {
        if (document.body.contains(notification)) {
            notification.remove();
        }
    }, 5000);
}

function showSuccessMessage(message) {
    showNotification(message, 'success');
}

function showError(message) {
    showNotification(message, 'error');
}
