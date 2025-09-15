# Study Buddy Bot

A Telegram bot for NUS students to find study partners based on modules, year, and study preferences.

## Features

- 🔍 Find study buddies based on modules and preferences
- 💬 Temporary chat system with message limits
- 📝 Profile management with validation
- 🛡️ Content moderation and safety features
- 🎯 Smart matching algorithm

## Deployment on Render

This bot is configured to deploy automatically on Render when you push to your repository.

### Prerequisites

1. GitHub repository with your bot code
2. Render account (free tier available)
3. Telegram bot token from @BotFather
4. Firebase project with Firestore database

### Setup Instructions

1. **Clone the repository**
   ```bash
   git clone https://github.com/chenguo3125/NUS-StudyBuddy.git
   cd NUS-StudyBuddy
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   - Copy `env.example` to `.env`
   - Copy `service-account.example.json` to `service-account.json`
   - Fill in your actual values

4. **Configure Firebase**
   - Create a Firebase project
   - Enable Firestore database
   - Generate a service account key
   - Replace the content in `service-account.json`

### Environment Variables

Set these in your Render dashboard:

- `BOT_TOKEN`: Your Telegram bot token
- `GOOGLE_APPLICATION_CREDENTIALS`: Path to service account JSON (./service-account.json)
- `NODE_ENV`: production

### Deployment Steps

1. Push your code to GitHub
2. Connect your GitHub repo to Render
3. Set environment variables
4. Deploy!

The bot will automatically build and start when deployed.
