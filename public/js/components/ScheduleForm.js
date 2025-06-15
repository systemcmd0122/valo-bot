class ScheduleForm {
    constructor() {
        this.form = document.getElementById('scheduleForm');
        this.dateTimeComponent = new DateTimeComponent();
        this.validationErrors = new Set();
        this.initializeForm();
    }

    initializeForm() {
        this.form.addEventListener('submit', this.handleSubmit.bind(this));
        this.setupValidation();
    }

    setupValidation() {
        const inputs = this.form.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            input.addEventListener('input', () => this.validateField(input));
            input.addEventListener('blur', () => this.validateField(input));
        });
    }

    validateField(field) {
        const value = field.value.trim();
        const name = field.name;
        
        switch (name) {
            case 'title':
                return this.validateTitle(value, field);
            case 'type':
                return this.validateType(value, field);
            case 'dateTime':
                return this.validateDateTime(value, field);
        }
    }

    validateTitle(value, field) {
        if (!value) {
            this.showError(field, 'タイトルは必須です');
            return false;
        }
        if (value.length < 3) {
            this.showError(field, 'タイトルは3文字以上で入力してください');
            return false;
        }
        if (value.length > 50) {
            this.showError(field, 'タイトルは50文字以内で入力してください');
            return false;
        }
        this.clearError(field);
        return true;
    }

    validateType(value, field) {
        if (!value) {
            this.showError(field, 'タイプは必須です');
            return false;
        }
        this.clearError(field);
        return true;
    }

    validateDateTime(value, field) {
        if (!value) {
            this.showError(field, '日時は必須です');
            return false;
        }
        const selectedDate = new Date(value);
        const now = new Date();
        if (selectedDate <= now) {
            this.showError(field, '過去の日時は選択できません');
            return false;
        }
        this.clearError(field);
        return true;
    }

    showError(field, message) {
        const errorElement = field.parentElement.querySelector('.form-error');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
        field.classList.add('error');
        this.validationErrors.add(field.name);
    }

    clearError(field) {
        const errorElement = field.parentElement.querySelector('.form-error');
        if (errorElement) {
            errorElement.style.display = 'none';
        }
        field.classList.remove('error');
        this.validationErrors.delete(field.name);
    }

    async handleSubmit(event) {
        event.preventDefault();

        if (this.validationErrors.size > 0) {
            return;
        }

        const formData = new FormData(this.form);
        const scheduleData = {
            title: formData.get('title'),
            type: formData.get('type'),
            dateTime: formData.get('dateTime'),
            description: formData.get('description')
        };

        try {
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

            const result = await response.json();
            if (result.success) {
                this.form.reset();
                this.dispatchEvent('scheduleCreated', result);
                return result;
            } else {
                throw new Error(result.error || 'スケジュールの作成に失敗しました');
            }
        } catch (error) {
            console.error('スケジュール作成エラー:', error);
            throw error;
        }
    }

    dispatchEvent(name, detail) {
        const event = new CustomEvent(name, { detail });
        this.form.dispatchEvent(event);
    }
}
