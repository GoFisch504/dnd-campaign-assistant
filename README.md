# D&D Campaign Assistant

A Discord bot that records voice sessions, transcribes them with OpenAI Whisper, and keeps notes for your campaign.

## Setup

1. Copy `.env.example` to `.env` and fill in your Discord and OpenAI credentials.
2. Install dependencies:

```bash
npm install
```

3. Run the bot:

```bash
npm start
```

### Commands

- `/start_recording` – Start capturing the current voice channel.
- `/stop_recording` – Stop recording and save the transcription.
- `/get_notes <character>` – Retrieve notes for a character from `data/notes.json`.

Transcripts are stored in `data/notes.json` under `sessions` and recordings are temporarily saved in the `recordings` directory.
