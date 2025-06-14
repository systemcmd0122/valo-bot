const express = require('express');
const session = require('express-session');
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');

// 開発環境のみ .env を読み込む
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

// 設定
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const AUTH_CHANNEL_ID = "1376861488827994183";
const NOTIFICATION_CHANNEL_ID = process.env.NOTIFICATION_CHANNEL_ID;
const PORT = process.env.PORT || 3000;

// スリープ防止設定（Koyeb用に最適化）
const KEEP_ALIVE_URL = process.env.KEEP_ALIVE_URL || `https://${process.env.KOYEB_PUBLIC_DOMAIN || `localhost:${PORT}`}`;
const PING_INTERVAL = 4 * 60 * 1000; // 4分間隔（Koyebの無料枠に最適化）
const HEALTH_CHECK_INTERVAL = 3 * 60 * 1000; // 3分間隔でヘルスチェック

// ファイルパス
const AUTH_KEY_FILE = process.env.AUTH_KEY_FILE || path.join(__dirname, 'auth_keys.json');
const SCHEDULE_FILE = process.env.SCHEDULE_FILE || path.join(__dirname, 'schedules.json');

// Expressアプリケーション
const app = express();

// Discord Bot
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

// Express設定
app.use(express.static('public'));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// メモリ内データストレージ
let schedules = [];
let nextId = 1;

// エラーハンドリング
process.on('uncaughtException', (error) => {
    console.error('未捕捉のエラー:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('未処理のPromise rejection:', error);
});

// 日本時間で日時をフォーマットする関数
function formatJST(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short'
    });
}

// ユーザー名を取得する関数
async function getUserDisplayName(userId) {
    try {
        const user = await client.users.fetch(userId);
        // ギルドメンバーの表示名を取得（ニックネーム優先）
        if (GUILD_ID) {
            try {
                const guild = await client.guilds.fetch(GUILD_ID);
                const member = await guild.members.fetch(userId);
                return member.displayName; // ニックネームまたはユーザー名
            } catch (memberError) {
                // ギルドメンバーでない場合はユーザー名を返す
                return user.globalName || user.username;
            }
        }
        return user.globalName || user.username;
    } catch (error) {
        console.error(`ユーザー名取得エラー (ID: ${userId}):`, error);
        return 'Unknown User';
    }
}

// 複数のURLでkeep-aliveを実行
function keepAlive() {
    const urls = [
        KEEP_ALIVE_URL + '/ping',
        KEEP_ALIVE_URL + '/health',
        KEEP_ALIVE_URL + '/system'
    ];

    urls.forEach((urlString, index) => {
        setTimeout(() => {
            const url = new URL(urlString);
            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname,
                method: 'GET',
                timeout: 15000, // タイムアウトを15秒に短縮
                headers: {
                    'User-Agent': 'KoyebKeepAlive/2.0',
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            };

            const clientHttp = url.protocol === 'https:' ? https : http;
            
            const req = clientHttp.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    console.log(`Keep-alive ping ${index + 1} successful: ${res.statusCode} at ${new Date().toISOString()}`);
                });
            });

            req.on('error', (error) => {
                console.error(`Keep-alive ping ${index + 1} failed:`, error.message);
                // エラー時は30秒後に再試行
                setTimeout(() => keepAlive(), 30000);
            });

            req.on('timeout', () => {
                console.error(`Keep-alive ping ${index + 1} timeout`);
                req.destroy();
                // タイムアウト時は1分後に再試行
                setTimeout(() => keepAlive(), 60000);
            });

            req.end();
        }, index * 1000); // 各リクエストを1秒間隔で実行
    });
}

// 拡張されたヘルスチェック
function performHealthCheck() {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();
    
    console.log(`Health Check - Uptime: ${Math.floor(uptime / 60)}min, Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
    
    // メモリ使用量が過剰な場合の警告
    if (memUsage.heapUsed > 400 * 1024 * 1024) { // 400MB超過
        console.warn('High memory usage detected:', memUsage);
        // 必要に応じてガベージコレクションを強制実行
        if (global.gc) {
            global.gc();
            console.log('Garbage collection triggered');
        }
    }
}

// 定期実行の設定（改良版）
function startKeepAlive() {
    console.log('Starting enhanced keep-alive system...');
    
    // 即座に実行
    keepAlive();
    performHealthCheck();
    
    // Keep-alive間隔
    const keepAliveInterval = setInterval(() => {
        keepAlive();
    }, PING_INTERVAL);
    
    // ヘルスチェック間隔
    const healthInterval = setInterval(() => {
        performHealthCheck();
    }, HEALTH_CHECK_INTERVAL);
    
    // 時間帯に応じた頻度調整（オプション）
    const dynamicInterval = setInterval(() => {
        const hour = new Date().getHours();
        // 深夜帯（2-6時）はより頻繁にping
        if (hour >= 2 && hour <= 6) {
            keepAlive();
        }
    }, 4 * 60 * 1000); // 4分間隔
    
    // プロセス終了時のクリーンアップ
    const cleanup = () => {
        console.log('Cleaning up intervals...');
        clearInterval(keepAliveInterval);
        clearInterval(healthInterval);
        clearInterval(dynamicInterval);
    };
    
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', () => {
        cleanup();
        process.exit(0);
    });
    
    console.log(`Enhanced keep-alive started - Ping: ${PING_INTERVAL / 1000 / 60}min, Health: ${HEALTH_CHECK_INTERVAL / 1000 / 60}min`);
}

// スケジュールの読み込み
async function loadSchedules() {
    try {
        const data = await fs.readFile(SCHEDULE_FILE, 'utf8');
        schedules = JSON.parse(data);
        if (schedules.length > 0) {
            nextId = Math.max(...schedules.map(s => s.id)) + 1;
        }
        console.log(`Loaded ${schedules.length} schedules`);
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

// スケジュール埋め込みを作成
async function createScheduleEmbed(schedule, currentIndex, totalCount) {
    const participantNames = [];
    const absenteeNames = [];
    
    // 参加者名を取得
    for (const userId of schedule.participants) {
        const name = await getUserDisplayName(userId);
        participantNames.push(name);
    }
    
    // 不参加者名を取得
    for (const userId of schedule.absentees) {
        const name = await getUserDisplayName(userId);
        absenteeNames.push(name);
    }
    
    const participantsText = participantNames.length > 0 
        ? participantNames.join(', ')
        : 'まだ参加者がいません';
        
    const absenteesText = absenteeNames.length > 0
        ? absenteeNames.join(', ')
        : 'なし';

    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`📅 ${schedule.title}`)
        .setDescription(`**タイプ:** ${schedule.type}`)
        .addFields(
            { name: '🕒 日時', value: formatJST(schedule.dateTime), inline: true },
            { name: '👥 参加者数', value: `${schedule.participants.length}人`, inline: true },
            { name: '❌ 不参加者数', value: `${schedule.absentees.length}人`, inline: true },
            { name: '📝 説明', value: schedule.description || 'なし' },
            { name: '✅ 参加予定', value: participantsText },
            { name: '❌ 不参加', value: absenteesText }
        )
        .setFooter({ text: `${currentIndex + 1} / ${totalCount} - 作成者: ${schedule.createdBy}` })
        .setTimestamp(new Date(schedule.dateTime));
    
    return embed;
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
            const expireAt = Date.now() + 10 * 60 * 1000;

            const entry = {
                key,
                discordId: interaction.user.id,
                username: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
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
                content: `認証コード: **${key}**\n※このコードは10分間有効です。`,
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
                const absentIndex = schedule.absentees.indexOf(userId);
                if (absentIndex > -1) {
                    schedule.absentees.splice(absentIndex, 1);
                }
                await saveSchedules();
                
                await interaction.reply({
                    content: `✅ **${schedule.title}** に参加表明しました！`,
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
                if (!schedule.absentees.includes(userId)) {
                    schedule.absentees.push(userId);
                }
                await saveSchedules();
                
                await interaction.reply({
                    content: `❌ **${schedule.title}** の参加をキャンセルしました。`,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: '参加表明していません。',
                    ephemeral: true
                });
            }
        } else if (interaction.customId.startsWith('schedule_nav_')) {
            const [, , action, currentIndexStr] = interaction.customId.split('_');
            const currentIndex = parseInt(currentIndexStr);
            
            const now = new Date();
            const activeSchedules = schedules
                .filter(s => new Date(s.dateTime) > now)
                .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

            if (activeSchedules.length === 0) {
                await interaction.update({
                    content: '予定されているスケジュールはありません。',
                    embeds: [],
                    components: []
                });
                return;
            }

            let newIndex = currentIndex;
            if (action === 'prev') {
                newIndex = currentIndex > 0 ? currentIndex - 1 : activeSchedules.length - 1;
            } else if (action === 'next') {
                newIndex = currentIndex < activeSchedules.length - 1 ? currentIndex + 1 : 0;
            }

            const schedule = activeSchedules[newIndex];
            const embed = await createScheduleEmbed(schedule, newIndex, activeSchedules.length);

            // ボタンの作成
            const prevButton = new ButtonBuilder()
                .setCustomId(`schedule_nav_prev_${newIndex}`)
                .setLabel('◀ 前へ')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(activeSchedules.length <= 1);

            const nextButton = new ButtonBuilder()
                .setCustomId(`schedule_nav_next_${newIndex}`)
                .setLabel('次へ ▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(activeSchedules.length <= 1);

            const joinButton = new ButtonBuilder()
                .setCustomId(`join_${schedule.id}`)
                .setLabel('参加する')
                .setStyle(ButtonStyle.Success);

            const cancelButton = new ButtonBuilder()
                .setCustomId(`cancel_${schedule.id}`)
                .setLabel('参加をキャンセル')
                .setStyle(ButtonStyle.Danger);

            const navRow = new ActionRowBuilder()
                .addComponents(prevButton, nextButton);
            
            const actionRow = new ActionRowBuilder()
                .addComponents(joinButton, cancelButton);

            await interaction.update({
                embeds: [embed],
                components: [navRow, actionRow]
            });
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
            .setLabel('🔑 認証コードを取得')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(button);

        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x00AE86)
                    .setTitle('🔑 認証リクエスト')
                    .setDescription(`**${interaction.member?.displayName || interaction.user.globalName || interaction.user.username}** さんの認証リクエスト\nボタンをクリックして認証コードを取得してください。`)
                    .setTimestamp()
            ],
            components: [row]
        });

        await interaction.reply({ 
            content: `${channel} に認証用メッセージを送信しました。\nボタンをクリックして認証コードを取得してください。`, 
            ephemeral: true 
        });
    } else if (interaction.commandName === 'schedules') {
        const subcommand = interaction.options.getSubcommand();
        const now = new Date();
        let filteredSchedules = [];
        
        switch (subcommand) {
            case 'list':
                filteredSchedules = schedules
                    .filter(s => new Date(s.dateTime) > now)
                    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
                break;
                
            case 'today':
                const endOfDay = new Date(now);
                endOfDay.setHours(23, 59, 59, 999);
                filteredSchedules = schedules
                    .filter(s => {
                        const scheduleDate = new Date(s.dateTime);
                        return scheduleDate >= now && scheduleDate <= endOfDay;
                    })
                    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
                break;
                
            case 'week':
                const endOfWeek = new Date(now);
                endOfWeek.setDate(now.getDate() + 7);
                filteredSchedules = schedules
                    .filter(s => {
                        const scheduleDate = new Date(s.dateTime);
                        return scheduleDate >= now && scheduleDate <= endOfWeek;
                    })
                    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
                break;
                
            case 'upcoming':
                const count = interaction.options.getInteger('count') || 3;
                filteredSchedules = schedules
                    .filter(s => new Date(s.dateTime) > now)
                    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime))
                    .slice(0, count);
                break;
        }

        if (filteredSchedules.length === 0) {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFFB347)
                        .setTitle('📅 スケジュール')
                        .setDescription('該当する予定はありません。')
                        .setTimestamp()
                ],
                ephemeral: true
            });
            return;
        }

        // 最初のスケジュールを表示
        const firstSchedule = filteredSchedules[0];
        const embed = await createScheduleEmbed(firstSchedule, 0, filteredSchedules.length);

        // ボタンの作成
        const components = [];
        
        if (filteredSchedules.length > 1) {
            const navButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`schedule_nav_prev_0`)
                        .setLabel('◀ 前へ')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId(`schedule_nav_next_0`)
                        .setLabel('次へ ▶')
                        .setStyle(ButtonStyle.Secondary)
                );
            components.push(navButtons);
        }

        const actionButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`join_${firstSchedule.id}`)
                    .setLabel('✅ 参加する')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`cancel_${firstSchedule.id}`)
                    .setLabel('❌ 参加をキャンセル')
                    .setStyle(ButtonStyle.Danger)
            );
        components.push(actionButtons);

        await interaction.reply({
            embeds: [embed],
            components: components,
            ephemeral: subcommand !== 'list'
        });
    } else if (interaction.commandName === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setColor(0x00AE86)
            .setTitle('📚 ボットの使い方')
            .setDescription('以下のコマンドが使用可能です：')
            .addFields(
                { 
                    name: '/get-auth', 
                    value: 'Webサイト用の認証コードを取得します。' 
                },
                { 
                    name: '/schedules list', 
                    value: '予定されているスケジュール一覧を表示します。' 
                },
                { 
                    name: '/schedules today', 
                    value: '今日のスケジュールを表示します。' 
                },
                { 
                    name: '/schedules week', 
                    value: '今週のスケジュール一覧を表示します。' 
                },
                { 
                    name: '/schedules upcoming', 
                    value: '直近の予定を表示します。数を指定可能です。' 
                }
            )
            .setTimestamp();

        await interaction.reply({
            embeds: [helpEmbed],
            ephemeral: true
        });
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
                    description: 'スケジュール一覧を表示（矢印ボタンで切り替え可能）',
                    type: 1
                },
                {
                    name: 'today',
                    description: '今日のスケジュールを表示',
                    type: 1
                },
                {
                    name: 'week',
                    description: '今週のスケジュール一覧を表示',
                    type: 1
                },
                {
                    name: 'upcoming',
                    description: '直近の予定を表示',
                    type: 1,
                    options: [
                        {
                            name: 'count',
                            description: '表示する予定の数（デフォルト: 3）',
                            type: 4,
                            required: false
                        }
                    ]
                }
            ]
        },
        {
            name: 'help',
            description: 'ボットの使い方を表示',
            type: 1
        }
    ];

    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        
        if (GUILD_ID) {
            await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
            console.log('ギルド固有のスラッシュコマンドを登録しました');
        } else {
            await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
            console.log('グローバルスラッシュコマンドを登録しました');
        }
    } catch (error) {
        console.error('スラッシュコマンド登録エラー:', error);
    }
}

// 強化されたKeep-alive用エンドポイント
app.get('/ping', (req, res) => {
    const timestamp = new Date().toISOString();
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    
    res.status(200).json({ 
        status: 'alive',
        timestamp,
        uptime: Math.floor(uptime),
        memory: {
            rss_mb: Math.round(memory.rss / 1024 / 1024),
            heapUsed_mb: Math.round(memory.heapUsed / 1024 / 1024),
            heapTotal_mb: Math.round(memory.heapTotal / 1024 / 1024)
        },
        schedulesCount: schedules.length,
        env: process.env.NODE_ENV || 'development'
    });
});

// より詳細なヘルスチェック用エンドポイント
app.get('/health', (req, res) => {
    const timestamp = new Date().toISOString();
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    
    // スケジュールの統計
    const now = new Date();
    const activeSchedules = schedules.filter(s => new Date(s.dateTime) > now);
    const pastSchedules = schedules.filter(s => new Date(s.dateTime) <= now);
    
    res.status(200).json({
        status: 'healthy',
        timestamp,
        uptime: {
            seconds: Math.floor(uptime),
            minutes: Math.floor(uptime / 60),
            hours: Math.floor(uptime / 3600)
        },
        memory: {
            rss_mb: Math.round(memory.rss / 1024 / 1024),
            heapUsed_mb: Math.round(memory.heapUsed / 1024 / 1024),
            heapTotal_mb: Math.round(memory.heapTotal / 1024 / 1024),
            external_mb: Math.round(memory.external / 1024 / 1024)
        },
        discord: {
            connected: client.isReady(),
            guilds: client.guilds.cache.size,
            users: client.users.cache.size
        },
        schedules: {
            total: schedules.length,
            active: activeSchedules.length,
            past: pastSchedules.length
        },
        env: process.env.NODE_ENV || 'development',
        platform: process.platform,
        nodeVersion: process.version
    });
});

// システム情報エンドポイント
app.get('/system', (req, res) => {
    res.status(200).json({
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
        env: {
            nodeEnv: process.env.NODE_ENV,
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version
        },
        koyeb: {
            publicDomain: process.env.KOYEB_PUBLIC_DOMAIN,
            region: process.env.KOYEB_REGION,
            appName: process.env.KOYEB_APP_NAME
        }
    });
});

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
            return res.json({ success: true, user: req.session.user });
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
        user: req.session.user || null
    });
});

app.get('/api/schedules', async (req, res) => {
    // 未来のスケジュールのみを返す（オプション）
    const includeAll = req.query.all === 'true';
    
    if (includeAll) {
        res.json(schedules);
    } else {
        const now = new Date();
        const activeSchedules = schedules
            .filter(s => new Date(s.dateTime) > now)
            .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
        res.json(activeSchedules);
    }
});

app.post('/api/schedules', async (req, res) => {
    if (!req.session.authenticated) {
        return res.status(401).json({ error: '認証が必要です' });
    }

    const { title, type, dateTime, description } = req.body;
    
    // バリデーション
    if (!title || !type || !dateTime) {
        return res.status(400).json({ error: '必須フィールドが不足しています' });
    }
    
    // 日時が過去でないかチェック
    if (new Date(dateTime) <= new Date()) {
        return res.status(400).json({ error: '過去の日時は設定できません' });
    }

    const newSchedule = {
        id: nextId++,
        title: title.trim(),
        type: type.trim(),
        dateTime,
        description: description ? description.trim() : '',
        createdBy: req.session.user.username,
        createdById: req.session.user.discordId,
        participants: [],
        absentees: [],
        notifiedAt: [],
        createdAt: new Date().toISOString()
    };

    schedules.push(newSchedule);
    await saveSchedules();
    
    // Discord通知
    try {
        const channelId = NOTIFICATION_CHANNEL_ID || AUTH_CHANNEL_ID;
        const channel = client.channels.cache.get(channelId);
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor(0x00AE86)
                .setTitle('📅 新しいスケジュールが追加されました')
                .addFields(
                    { name: 'タイトル', value: newSchedule.title, inline: true },
                    { name: 'タイプ', value: newSchedule.type, inline: true },
                    { name: '作成者', value: newSchedule.createdBy, inline: true },
                    { name: '日時', value: formatJST(newSchedule.dateTime) },
                    { name: '説明', value: newSchedule.description || 'なし' }
                )
                .setTimestamp()
                .setFooter({ text: 'スケジュール管理システム' });
            
            const joinButton = new ButtonBuilder()
                .setCustomId(`join_${newSchedule.id}`)
                .setLabel('✅ 参加する')
                .setStyle(ButtonStyle.Success);

            const row = new ActionRowBuilder().addComponents(joinButton);
            
            await channel.send({ embeds: [embed], components: [row] });
        }
    } catch (error) {
        console.error('Discord通知エラー:', error);
    }

    res.status(201).json(newSchedule);
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
            
            // スリープ防止機能を開始（本番環境のみ）
            if (process.env.NODE_ENV === 'production') {
                // サーバー起動から少し待ってからkeep-aliveを開始
                setTimeout(startKeepAlive, 30000); // 30秒後に開始
            } else {
                console.log('開発環境: Keep-alive機能は無効です');
            }
        });
    } catch (error) {
        console.error('サーバー起動エラー:', error);
        process.exit(1);
    }
}

startServer();