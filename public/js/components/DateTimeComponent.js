class DateTimeComponent {
    constructor() {
        this.dateInput = document.getElementById('missionDate');
        this.timeInput = document.getElementById('missionTime');
        this.hiddenDateTimeInput = document.getElementById('dateTime');
        this.initialize();
    }

    initialize() {
        this.setInitialValues();
        this.setupEventListeners();
    }

    setInitialValues() {
        // 明日の日付をデフォルトに設定
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];
        this.dateInput.value = tomorrowStr;

        // 今日の日付を最小値に設定
        const today = new Date().toISOString().split('T')[0];
        this.dateInput.min = today;

        // デフォルトの時間を設定（20:00）
        this.timeInput.value = '20:00';

        this.updateDateTime();
    }

    setupEventListeners() {
        this.dateInput.addEventListener('change', () => this.updateDateTime());
        this.timeInput.addEventListener('change', () => this.updateDateTime());
    }

    updateDateTime() {
        const dateValue = this.dateInput.value;
        const timeValue = this.timeInput.value;
        
        if (dateValue && timeValue) {
            const dateTime = new Date(`${dateValue}T${timeValue}`);
            this.hiddenDateTimeInput.value = dateTime.toISOString();
            
            // バリデーション
            const now = new Date();
            const isValid = dateTime > now;
            
            this.dispatchEvent('datetimeChange', {
                dateTime,
                isValid
            });
        }
    }

    dispatchEvent(name, detail) {
        const event = new CustomEvent(name, { detail });
        this.dateInput.dispatchEvent(event);
    }

    reset() {
        this.setInitialValues();
    }
}
