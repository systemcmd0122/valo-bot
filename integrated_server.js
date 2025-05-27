const express = require('express');
const session = require('express-session');
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// 設定
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const AUTH_CHANNEL_ID = "1376714437448306718";
const PORT = process.env.PORT || 3000;

// ファイルパス
const AUTH_KEY_FILE = path.join(__dirname, 'auth_keys.json');
const SCHEDULE_FILE = path.join(__dirname, 'schedules.json');

// Expressアプリケーション
const app = express();

// Discord Bot
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// Express設定
app.use(express.static('public'));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false
}));

// メモリ内データストレージ
let schedules = [];
let nextId = 1;

// スケジュールの読み込み
async function loadSchedules() {
    try {
        const data = await fs.readFile(SCHEDULE_FILE, 'utf8');
        schedules = JSON.parse(data);
        if (schedules.length > 0) {
            nextId = Math.max(...schedules.map(s => s.id)) + 1;
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('スケジュール読み込みエラー:', error);
        }
    }
}

// スケジュールの保存
async function saveSchedules() {
    try {
        await fs.writeFile(SCHEDULE_FILE, JSON.stringify(schedules, null, 2));
    } catch (error) {
        console.error('スケジュール保存エラー:', error);
    }
}

// Discord Bot コマンド処理
client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        if (interaction.customId.startsWith('auth_')) {
            const userId = interaction.customId.split('_')[1];
            
            if (interaction.user.id !== userId) {
                await interaction.reply({ content: 'このボタンは他の人用です。', ephemeral: true });
                return;
            }

            const key = Math.random().toString(36).slice(-6).toUpperCase();
            const expireAt = Date.now() + 10 * 60 * 1000; // 10分有効

            const entry = {
                key,
                discordId: interaction.user.id,
                username: interaction.user.username,
                expireAt,
                used: false
            };

            let keys = [];
            try {
                const data = await fs.readFile(AUTH_KEY_FILE, 'utf8');
                keys = JSON.parse(data);
            } catch (e) {}

            keys = keys.filter(k => k.expireAt > Date.now());
            keys.push(entry);

            await fs.writeFile(AUTH_KEY_FILE, JSON.stringify(keys, null, 2));

            await interaction.reply({ 
                content: `認証コード: ${key}\n※このコードは10分間有効です。`,
                ephemeral: true 
            });
        } else if (interaction.customId.startsWith('join_')) {
            const scheduleId = parseInt(interaction.customId.split('_')[1]);
            const schedule = schedules.find(s => s.id === scheduleId);
            
            if (!schedule) {
                await interaction.reply({ content: 'スケジュールが見つかりません。', ephemeral: true });
                return;
            }

            const userId = interaction.user.id;
            if (!schedule.participants.includes(userId)) {
                schedule.participants.push(userId);
                // 不参加リストから削除
                const absentIndex = schedule.absentees.indexOf(userId);
                if (absentIndex > -1) {
                    schedule.absentees.splice(absentIndex, 1);
                }
                await saveSchedules();
                
                await interaction.reply({
                    content: `${schedule.title}に参加表明しました！`,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: '既に参加表明済みです。',
                    ephemeral: true
                });
            }
        } else if (interaction.customId.startsWith('cancel_')) {
            const scheduleId = parseInt(interaction.customId.split('_')[1]);
            const schedule = schedules.find(s => s.id === scheduleId);
            
            if (!schedule) {
                await interaction.reply({ content: 'スケジュールが見つかりません。', ephemeral: true });
                return;
            }

            const userId = interaction.user.id;
            const participantIndex = schedule.participants.indexOf(userId);
            if (participantIndex > -1) {
                schedule.participants.splice(participantIndex, 1);
                schedule.absentees.push(userId);
                await saveSchedules();
                
                await interaction.reply({
                    content: `${schedule.title}の参加をキャンセルしました。`,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: '参加表明していません。',
                    ephemeral: true
                });
            }
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'get-auth') {
        const channel = client.channels.cache.get(AUTH_CHANNEL_ID);
        if (!channel) {
            await interaction.reply({ 
                content: '認証用チャンネルが見つかりません。', 
                ephemeral: true 
            });
            return;
        }

        const button = new ButtonBuilder()
            .setCustomId(`auth_${interaction.user.id}`)
            .setLabel('認証コードを取得')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(button);

        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x00AE86)
                    .setTitle('🔑 認証リクエスト')
                    .setDescription(`${interaction.user.username}さんの認証リクエスト\nボタンをクリックして認証コードを取得してください。`)
                    .setTimestamp()
            ],
            components: [row]
        });

        await interaction.reply({ 
            content: `${channel}に認証用メッセージを送信しました。\nボタンをクリックして認証コードを取得してください。`, 
            ephemeral: true 
        });
    } else if (interaction.commandName === 'schedules') {
        const subcommand = interaction.options.getSubcommand();
        
        if (subcommand === 'list') {
            const now = new Date();
            const activeSchedules = schedules
                .filter(s => new Date(s.dateTime) > now)
                .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

            if (activeSchedules.length === 0) {
                await interaction.reply('予定されているスケジュールはありません。');
                return;
            }

            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle('📅 スケジュール一覧');

            activeSchedules.slice(0, 10).forEach(schedule => {
                const participantsCount = schedule.participants.length;
                const absenteesCount = schedule.absentees.length;
                const isCreator = interaction.user.id === schedule.createdById;
                const isParticipant = schedule.participants.includes(interaction.user.id);

                embed.addFields({
                    name: `${schedule.title} (${schedule.type})`,
                    value: `🕒 ${new Date(schedule.dateTime).toLocaleString('ja-JP')}\n` +
                          `👥 参加: ${participantsCount}人 | 不参加: ${absenteesCount}人\n` +
                          `📝 ${schedule.description || 'なし'}\n` +
                          `${isCreator ? '(あなたが作成)' : ''}${isParticipant ? '(参加予定)' : ''}`
                });
            });

            const joinButton = new ButtonBuilder()
                .setCustomId(`join_${activeSchedules[0].id}`)
                .setLabel('参加する')
                .setStyle(ButtonStyle.Success);

            const cancelButton = new ButtonBuilder()
                .setCustomId(`cancel_${activeSchedules[0].id}`)
                .setLabel('参加をキャンセル')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder()
                .addComponents(joinButton, cancelButton);

            await interaction.reply({ embeds: [embed], components: [row] });
        }
    }
});

// スラッシュコマンド登録
async function deployCommands() {
    const commands = [
        {
            name: 'get-auth',
            description: 'Webサイト用の認証コードを取得します'
        },
        {
            name: 'schedules',
            description: 'スケジュール管理',
            options: [
                {
                    name: 'list',
                    description: 'スケジュール一覧を表示',
                    type: 1
                }
            ]
        }
    ];

    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('スラッシュコマンドを登録しました');
    } catch (error) {
        console.error('スラッシュコマンド登録エラー:', error);
    }
}

// Express ルート
app.post('/api/auth/login', async (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: '認証キーが必要です' });
    
    try {
        const data = await fs.readFile(AUTH_KEY_FILE, 'utf8');
        const keys = JSON.parse(data);
        const found = keys.find(k => k.key === key && !k.used && Date.now() < k.expireAt);
        
        if (found) {
            req.session.authenticated = true;
            req.session.user = { discordId: found.discordId, username: found.username };
            found.used = true;
            await fs.writeFile(AUTH_KEY_FILE, JSON.stringify(keys, null, 2));
            return res.json({ success: true });
        }
        
        return res.status(401).json({ error: '認証キーが無効か期限切れです' });
    } catch (e) {
        return res.status(401).json({ error: '認証キーが無効です' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/status', (req, res) => {
    res.json({
        authenticated: !!req.session.authenticated,
        user: req.session.user
    });
});

app.get('/api/schedules', async (req, res) => {
    res.json(schedules);
});

app.post('/api/schedules', async (req, res) => {
    if (!req.session.authenticated) {
        return res.status(401).json({ error: '認証が必要です' });
    }

    const newSchedule = {
        id: nextId++,
        ...req.body,
        createdBy: req.session.user.username,
        createdById: req.session.user.discordId,
        participants: [],
        absentees: [],
        notifiedAt: []
    };

    schedules.push(newSchedule);
    await saveSchedules();
    
    // Discord通知
    try {
        const channel = client.channels.cache.get(AUTH_CHANNEL_ID);
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor(0x00AE86)
                .setTitle('📅 新しいスケジュールが追加されました')
                .addFields(
                    { name: 'タイトル', value: newSchedule.title },
                    { name: 'タイプ', value: newSchedule.type },
                    { name: '日時', value: new Date(newSchedule.dateTime).toLocaleString('ja-JP') },
                    { name: '説明', value: newSchedule.description || 'なし' }
                )
                .setTimestamp();
            
            await channel.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error('Discord通知エラー:', error);
    }

    res.json(newSchedule);
});

// 参加管理API
app.post('/api/schedules/:id/join', async (req, res) => {
    if (!req.session.authenticated) {
        return res.status(401).json({ error: '認証が必要です' });
    }

    const scheduleId = parseInt(req.params.id);
    const schedule = schedules.find(s => s.id === scheduleId);
    
    if (!schedule) {
        return res.status(404).json({ error: 'スケジュールが見つかりません' });
    }

    const userId = req.session.user.discordId;
    if (!schedule.participants.includes(userId)) {
        schedule.participants.push(userId);
        const absentIndex = schedule.absentees.indexOf(userId);
        if (absentIndex > -1) {
            schedule.absentees.splice(absentIndex, 1);
        }
        await saveSchedules();
    }

    res.json({ success: true, schedule });
});

app.post('/api/schedules/:id/cancel', async (req, res) => {
    if (!req.session.authenticated) {
        return res.status(401).json({ error: '認証が必要です' });
    }

    const scheduleId = parseInt(req.params.id);
    const schedule = schedules.find(s => s.id === scheduleId);
    
    if (!schedule) {
        return res.status(404).json({ error: 'スケジュールが見つかりません' });
    }

    const userId = req.session.user.discordId;
    const participantIndex = schedule.participants.indexOf(userId);
    if (participantIndex > -1) {
        schedule.participants.splice(participantIndex, 1);
        schedule.absentees.push(userId);
        await saveSchedules();
    }

    res.json({ success: true, schedule });
});

// ページルート
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    if (!req.session.authenticated) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// サーバー起動
async function startServer() {
    try {
        await loadSchedules();
        await client.login(TOKEN);
        await deployCommands();
        
        app.listen(PORT, () => {
            console.log(`サーバーが起動しました: http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('サーバー起動エラー:', error);
        process.exit(1);
    }
}

startServer();
