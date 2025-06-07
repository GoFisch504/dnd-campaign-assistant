require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, SlashCommandBuilder, Routes } = require('discord.js');
const { REST } = require('@discordjs/rest');
const {
  joinVoiceChannel,
  EndBehaviorType,
} = require('@discordjs/voice');
const prism = require('prism-media');
const OpenAI = require('openai');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const NOTES_FILE = path.join(__dirname, '..', 'data', 'notes.json');

function loadNotes() {
  if (!fs.existsSync(NOTES_FILE)) {
    return { characters: {}, sessions: [] };
  }
  return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8'));
}

function saveNotes(notes) {
  fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2));
}

const openai = new OpenAI({ apiKey: OPENAI_KEY });

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
] });

const commands = [
  new SlashCommandBuilder().setName('start_recording').setDescription('Start recording the voice channel.'),
  new SlashCommandBuilder().setName('stop_recording').setDescription('Stop recording and transcribe.'),
  new SlashCommandBuilder().setName('get_notes').setDescription('Get notes about a character').addStringOption(o =>
    o.setName('character').setDescription('Character name').setRequired(true)
  ),
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Commands registered');
  } catch (err) {
    console.error('Failed to register commands', err);
  }
}

const recordings = new Map(); // guildId -> { connection, streams: Map(userId, writeStream) }

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'start_recording') {
    if (!interaction.member.voice.channel) {
      await interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
      return;
    }
    const channel = interaction.member.voice.channel;
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });
    const receiver = connection.receiver;
    const userStreams = new Map();
    receiver.speaking.on('start', userId => {
      const opusStream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 100 } });
      const oggStream = new prism.opus.OggLogicalBitstream({ opusHead: new prism.opus.OpusHead({ channelCount: 2, sampleRate: 48000 }) });
      const pcmPath = path.join(__dirname, '..', 'recordings');
      if (!fs.existsSync(pcmPath)) fs.mkdirSync(pcmPath);
      const outPath = path.join(pcmPath, `${Date.now()}-${userId}.ogg`);
      const writeStream = fs.createWriteStream(outPath);
      opusStream.pipe(oggStream).pipe(writeStream);
      userStreams.set(userId, { writeStream, path: outPath });
    });
    recordings.set(channel.guild.id, { connection, streams: userStreams });
    await interaction.reply('Recording started.');
  } else if (interaction.commandName === 'stop_recording') {
    const record = recordings.get(interaction.guildId);
    if (!record) {
      await interaction.reply({ content: 'Nothing is being recorded.', ephemeral: true });
      return;
    }
    record.connection.destroy();
    const transcripts = [];
    for (const { path: audioPath, writeStream } of record.streams.values()) {
      writeStream.end();
      try {
        const resp = await openai.createTranscription(fs.createReadStream(audioPath), 'whisper-1');
        transcripts.push(resp.data.text);
        fs.unlinkSync(audioPath);
      } catch (err) {
        console.error('Transcription failed', err);
      }
    }
    recordings.delete(interaction.guildId);
    const notes = loadNotes();
    notes.sessions.push({ date: new Date().toISOString(), transcript: transcripts.join('\n') });
    saveNotes(notes);
    await interaction.reply('Recording stopped and saved.');
  } else if (interaction.commandName === 'get_notes') {
    const name = interaction.options.getString('character');
    const notes = loadNotes();
    const info = notes.characters[name];
    if (info) {
      await interaction.reply(`**${name}**:\n${info}`);
    } else {
      await interaction.reply(`No info found for ${name}.`);
    }
  }
});

registerCommands().then(() => client.login(TOKEN));
