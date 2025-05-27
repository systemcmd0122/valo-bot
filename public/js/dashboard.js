// グローバル変数
let currentUser = null;
let scheduleModal = null;
let dateTimePicker = null;

// ユーザー情報の取得と表示
async function loadUserInfo() {
    try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();
        if (data.authenticated && data.user) {
            currentUser = data.user;
            document.getElementById('username').textContent = `${data.user.username}`;
        } else {
            window.location.href = '/';
        }
    } catch (error) {
        console.error('ユーザー情報の取得に失敗:', error);
        window.location.href = '/';
    }
}

// スケジュールの作成
async function createSchedule(scheduleData) {
    const form = document.getElementById('scheduleForm');
    const submitBtn = form.querySelector('button[type="submit"]');
    
    try {
        submitBtn.disabled = true;
        submitBtn.textContent = '作成中...';

        const response = await fetch('/api/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(scheduleData)
        });

        if (!response.ok) throw new Error('スケジュールの作成に失敗しました');

        const newSchedule = await response.json();
        await loadSchedules();
        scheduleModal.close();
        return newSchedule;
    } catch (error) {
        console.error('スケジュール作成エラー:', error);
        alert('スケジュールの作成に失敗しました');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '作成';
    }
}

// ボタンのローディング状態を設定する関数
function setButtonLoading(button, isLoading, originalText) {
    if (isLoading) {
        button.disabled = true;
        button.innerHTML = `
            <div class="loading-spinner"></div>
            <span>処理中...</span>
        `;
    } else {
        button.disabled = false;
        button.textContent = originalText;
    }
}

// スケジュール参加処理
async function joinSchedule(scheduleId, button) {
    try {
        setButtonLoading(button, true);

        const response = await fetch(`/api/schedules/${scheduleId}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) throw new Error('参加処理に失敗しました');
        await loadSchedules();
    } catch (error) {
        console.error('参加処理エラー:', error);
        alert('参加処理に失敗しました');
        setButtonLoading(button, false, '参加する');
    }
}

// スケジュール参加キャンセル処理
async function cancelSchedule(scheduleId, button) {
    try {
        setButtonLoading(button, true);

        const response = await fetch(`/api/schedules/${scheduleId}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) throw new Error('キャンセル処理に失敗しました');
        await loadSchedules();
    } catch (error) {
        console.error('キャンセル処理エラー:', error);
        alert('キャンセル処理に失敗しました');
        setButtonLoading(button, false, 'キャンセル');
    }
}

// スケジュール一覧の取得と表示
async function loadSchedules(filter = 'upcoming') {
    const scheduleList = document.getElementById('scheduleList');
    const loading = document.createElement('div');
    loading.className = 'loading-state';
    loading.innerHTML = '<div class="loading-spinner"></div><p>スケジュールを読み込んでいます...</p>';
    scheduleList.innerHTML = '';
    scheduleList.appendChild(loading);

    try {
        const response = await fetch('/api/schedules');
        const schedules = await response.json();

        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const filteredSchedules = schedules
            .filter(schedule => {
                const scheduleDate = new Date(schedule.dateTime);
                switch (filter) {
                    case 'today':
                        return scheduleDate.toDateString() === now.toDateString() && scheduleDate > now;
                    case 'tomorrow':
                        return scheduleDate.toDateString() === tomorrow.toDateString();
                    case 'my':
                        return (schedule.participants.includes(currentUser.discordId) ||
                               schedule.createdById === currentUser.discordId) &&
                               scheduleDate > now;
                    case 'upcoming':
                    default:
                        return scheduleDate > now;
                }
            })
            .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

        scheduleList.innerHTML = '';

        if (filteredSchedules.length === 0) {
            scheduleList.innerHTML = '<p class="no-schedules">スケジュールはありません</p>';
            return;
        }

        filteredSchedules.forEach(schedule => {
            const template = document.getElementById('scheduleCardTemplate');
            const card = template.content.cloneNode(true);
            const scheduleDate = new Date(schedule.dateTime);
            
            const isCreator = schedule.createdById === currentUser.discordId;
            const isParticipant = schedule.participants.includes(currentUser.discordId);
            const isAbsent = schedule.absentees.includes(currentUser.discordId);

            // カード内容の設定
            card.querySelector('.title').textContent = schedule.title;
            card.querySelector('.type-badge').textContent = schedule.type;
            card.querySelector('.datetime').textContent = formatDateTime(scheduleDate);
            card.querySelector('.description').textContent = schedule.description || '説明なし';
            
            const participantCount = card.querySelector('.participant-count');
            participantCount.textContent = 
                `参加者: ${schedule.participants.length}人 / 不参加: ${schedule.absentees.length}人`;
            participantCount.title = schedule.participants.length > 0 ?
                `参加者: ${schedule.participants.join(', ')}` : '参加者なし';

            // 参加ステータス表示
            const statusText = isCreator ? '作成者' : 
                             isParticipant ? '参加予定' :
                             isAbsent ? '不参加' : '未回答';
            card.querySelector('.participation-status').textContent = statusText;

            // ボタンの設定
            const joinBtn = card.querySelector('.join-btn');
            const cancelBtn = card.querySelector('.cancel-btn');

            if (scheduleDate <= now) {
                joinBtn.disabled = true;
                cancelBtn.disabled = true;
            } else {
                joinBtn.disabled = isParticipant;
                cancelBtn.disabled = !isParticipant;

                joinBtn.addEventListener('click', () => joinSchedule(schedule.id, joinBtn));
                cancelBtn.addEventListener('click', () => cancelSchedule(schedule.id, cancelBtn));
            }

            scheduleList.appendChild(card);
        });
    } catch (error) {
        console.error('スケジュール取得エラー:', error);
        scheduleList.innerHTML = '<p class="error-message">スケジュールの取得に失敗しました</p>';
    } finally {
        scheduleList.classList.remove('loading');
    }
}

// 日時のフォーマット
function formatDateTime(date) {
    return new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(date);
}

// イベントリスナーの設定
document.addEventListener('DOMContentLoaded', () => {
    // 初期化
    loadUserInfo();
    loadSchedules();
    
    // Flatpickr（日時選択）の初期化
    const dateTimeInput = document.getElementById('dateTime');
    const calendarTrigger = document.querySelector('.calendar-trigger');
    
    dateTimePicker = flatpickr(dateTimeInput, {
        locale: 'ja',
        enableTime: true,
        dateFormat: "Y年m月d日(D) H:i",
        minDate: "today",
        time_24hr: true,
        minuteIncrement: 15,
        defaultHour: 20,
        defaultMinute: 0,
        position: "auto center",
        disableMobile: true,
        static: true,
        monthSelectorType: 'static',
        showMonths: window.innerWidth >= 768 ? 2 : 1,
        animate: true,
        onChange: function(selectedDates, dateStr) {
            const now = new Date();
            if (selectedDates[0] < now) {
                dateTimeInput.parentElement.classList.add('error');
                dateTimeInput.nextElementSibling.nextElementSibling.textContent = '過去の日時は選択できません';
                dateTimePicker.clear();
                return;
            }
            dateTimeInput.parentElement.classList.remove('error');
            dateTimeInput.nextElementSibling.nextElementSibling.textContent = dateStr;
            dateTimeInput.value = dateStr;
        },
        onOpen: function() {
            dateTimeInput.parentElement.classList.add('calendar-open');
            document.body.style.overflow = 'hidden';
        },
        onClose: function() {
            dateTimeInput.parentElement.classList.remove('calendar-open');
            document.body.style.overflow = '';
        }
    });

    // カレンダーアイコンクリックでも開けるように
    calendarTrigger.addEventListener('click', () => {
        dateTimePicker.open();
    });
    
    // モーダル設定
    scheduleModal = document.getElementById('scheduleModal');
    const newScheduleBtn = document.getElementById('newScheduleBtn');
    const closeButtons = document.querySelectorAll('[data-close-modal]');
    
    newScheduleBtn.addEventListener('click', () => {
        scheduleModal.showModal();
        const now = new Date();
        now.setHours(20, 0, 0, 0);
        if (now < new Date()) {
            now.setDate(now.getDate() + 1);
        }
        dateTimePicker.setDate(now);
    });
    
    closeButtons.forEach(button => {
        button.addEventListener('click', () => {
            scheduleModal.close();
            dateTimePicker.clear();
        });
    });

    // スケジュールフォーム
    const scheduleForm = document.getElementById('scheduleForm');
    const formError = scheduleForm.querySelector('.form-error');

    function showFormError(message, field = null) {
        formError.textContent = message;
        if (field) {
            const formGroup = field.closest('.form-group');
            formGroup.classList.add('error');
            field.focus();
            formGroup.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function clearFormErrors() {
        formError.textContent = '';
        scheduleForm.querySelectorAll('.form-group.error').forEach(group => {
            group.classList.remove('error');
        });
    }

    // フォーム送信処理の改善
    scheduleForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormErrors();
        
        const submitBtn = scheduleForm.querySelector('button[type="submit"]');
        const buttonContent = submitBtn.querySelector('.button-content');
        const formData = new FormData(scheduleForm);
        const dateTime = dateTimePicker.selectedDates[0];
        
        // バリデーション
        const titleInput = scheduleForm.querySelector('#title');
        if (!formData.get('title').trim()) {
            showFormError('タイトルを入力してください', titleInput);
            return;
        }
        
        const typeSelect = scheduleForm.querySelector('#type');
        if (!formData.get('type')) {
            showFormError('タイプを選択してください', typeSelect);
            return;
        }
        
        const dateTimeInput = scheduleForm.querySelector('#dateTime');
        if (!dateTime) {
            showFormError('日時を選択してください', dateTimeInput);
            return;
        }

        // 現在時刻より前の場合はエラー
        if (dateTime < new Date()) {
            showFormError('過去の日時は選択できません', dateTimeInput);
            return;
        }

        try {
            submitBtn.disabled = true;
            buttonContent.innerHTML = `
                <div class="loading-spinner"></div>
                <span>作成中...</span>
            `;

            const scheduleData = {
                title: formData.get('title').trim(),
                type: formData.get('type'),
                dateTime: dateTime.toISOString(),
                description: formData.get('description').trim()
            };

            await createSchedule(scheduleData);
            scheduleForm.reset();
            dateTimePicker.clear();
            scheduleModal.close();
        } catch (error) {
            showFormError('作成に失敗しました。もう一度お試しください。');
        } finally {
            submitBtn.disabled = false;
            buttonContent.innerHTML = '作成';
        }
    });

    // フィルターボタン
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            filterButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            loadSchedules(button.dataset.filter);
        });
    });

    // ログアウトボタン
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
            window.location.href = '/';
        } catch (error) {
            console.error('ログアウトエラー:', error);
            alert('ログアウトに失敗しました');
        }
    });
});
