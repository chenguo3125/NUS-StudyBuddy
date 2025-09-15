import 'dotenv/config'
import { Telegraf, Markup } from 'telegraf'
import * as admin from 'firebase-admin'
import { db, usersCol, matchesCol } from './firebase'
import { scorePair, UserDoc, Medium } from './matching'

if (!process.env.BOT_TOKEN) {
  throw new Error('BOT_TOKEN missing in .env')
}

const bot = new Telegraf(process.env.BOT_TOKEN)

const ts = () => admin.firestore.FieldValue.serverTimestamp()

// Session tracking for text input
const userSessions = new Map<number, string>()

// Temporary chat sessions (userId -> {otherUserId, messageCount, lastMessageFrom})
const tempChatSessions = new Map<number, {otherUserId: number, messageCount: number, lastMessageFrom: number}>()

// Content moderation - Common majors and module patterns
const VALID_MAJORS = new Set([
  // Computing
  'artificial intelligence', 'ai',
  'computer science', 'cs',
  'information systems', 'is',
  'information security', 'infosec',
  'business analytics', 'ba', // note clash w/ business admin, handle separately
  'computer engineering', 'ceg',
  'software engineering', 'se',
  'data science analytics', 'dsa',
  'cybersecurity',
  'machine learning', 'ml',
  'robotics', 'robo',

  // Engineering
  'engineering', 'eng',
  'mechanical engineering', 'me',
  'electrical engineering', 'ee',
  'civil engineering', 'civil',
  'chemical engineering', 'che',
  'biomedical engineering', 'bme',
  'aerospace engineering', 'aero',
  'industrial systems engineering', 'ise',
  'environmental engineering',
  'materials science and engineering', 'mse',
  'engineering science', 'engsci',

  // Business / Accountancy
  'business administration', 'biz', 'bba',
  'accountancy', 'accounting', 'acc',
  'finance',
  'marketing',
  'operations and supply chain management', 'osc',
  'management', 'mgmt',
  'entrepreneurship',
  'human resources', 'hr',
  'business analytics', 'biz analytics',
  'real estate',
  'economics', 'econs',

  // Science (FoS)
  'mathematics', 'math',
  'applied mathematics',
  'pure mathematics',
  'statistics', 'stats',
  'physics',
  'chemistry',
  'biology',
  'life sciences', 'lsm',
  'biochemistry',
  'environmental studies', 'envs',
  'pharmaceutical science',

  // Medicine, Dentistry, Nursing, Pharmacy, Public Health
  'medicine', 'mbbs',
  'nursing',
  'pharmacy',
  'pharmaceutical science', 'pharmsci',
  'dentistry',
  'public health',

  // Design & Architecture
  'architecture', 'archi',
  'industrial design', 'did',
  'urban planning',
  'project and facilities management', 'pfm',

  // Arts & Social Sciences
  'psychology', 'psych',
  'sociology',
  'political science', 'polisci',
  'history',
  'literature', 'english literature',
  'philosophy',
  'geography', 'geo',
  'communications and new media', 'cnm',
  'linguistics', 'lang studies',
  'global studies',
  'southeast asian studies', 'seas',
   'social work',

  // Law
  'law', 'llb',

  // Music
  'music', 'yong siew toh conservatory', 'yst',

  // Education
  'education', 'teacher training',

  // Cross-disciplinary / Special
  'philosophy, politics and economics', 'ppe',
  'environmental studies',
  'concurrent degree programme', 'cdp',
  'interdisciplinary studies'
])

const MODULE_PATTERNS = [
  // Common module code patterns (e.g., CS2030S, ST2334, MA1101R)
  /^[A-Z]{2,5}\d{4}[A-Z]?$/i,  // CS2030S, ST2334, MA1101R
  /^[A-Z]{2,5}\d{3}[A-Z]?$/i,  // CS203, ST233, MA110
  /^[A-Z]{2,5}\d{2}[A-Z]?$/i,  // CS20, ST23, MA11
]

// Inappropriate content patterns
const INAPPROPRIATE_PATTERNS = [
  /fuck|fk|fu|shit|damn|bitch|asshole|hole/i,
  /spam|scam|fake|test|asdf|qwerty/i,
  /nude|sex|porn|xxx/i,
  /hate|kill|die|suicide/i,
  /睡|约|上床/i,
  /我操|操|吊|逼|屌|操你妈|操你爹|操你全家|操你大爷|操你奶奶|操你祖宗/i,
]

// Chat moderation patterns - harassment and privacy-invading content
const HARASSMENT_PATTERNS = [
  // Direct harassment
  /ugly|fat|stupid|idiot|loser|weirdo|creep|freak/i,
  /shut up|shutup|go away|leave me alone|stop talking/i,
  /you're annoying|you annoy me|you're bothering me/i,
  
  // Sexual harassment
  /sexy|hot|beautiful|gorgeous|attractive|date me|go out with me/i,
  /kiss|hug|touch|feel|body|boobs|ass|dick|pussy/i,
  /send me your photo|send me a pic|show me your face/i,
  /睡|约|上床/i,
  
  // Privacy invasion
  /what's your number|give me your number|phone number|contact/i,
  /where do you live|what's your address/i,
  /what's your real name|tell me your name|full name/i,
  /social media|instagram|facebook|snapchat|tiktok|follow me/i,
  /meet me|come over|visit me|hang out/i,
  
  // Aggressive behavior
  /fuck you|fuck off|fuck|fk|fu|piss off|get lost|screw you/i,
  /i hate you|i don't like you|you suck|you're worthless/i,
  /threat|threaten|hurt you|kill you|beat you/i,
  
  // Inappropriate requests
  /send me money|give me money|pay me|buy me/i,
  /do my homework|i want to|sleep with|help me cheat|copy your work/i,
  /skip class|skip school|play hooky/i,
]

// Warning patterns (less severe but still inappropriate)
const WARNING_PATTERNS = [
  /personal question|private question|personal info/i,
  /what do you look like|describe yourself|appearance/i,
  /are you single|do you have a boyfriend|relationship status/i,
  /age|how old are you|birthday|birth date/i
]

// ---------- Content Moderation Functions ----------
function validateMajor(major: string): { isValid: boolean; error?: string } {
  const cleanMajor = major.trim().toLowerCase()
  
  // Check for inappropriate content
  for (const pattern of INAPPROPRIATE_PATTERNS) {
    if (pattern.test(cleanMajor)) {
      return { isValid: false, error: 'Please enter a real major name. Inappropriate content is not allowed.' }
    }
  }
  
  // Check if it's a valid major
  if (!VALID_MAJORS.has(cleanMajor)) {
    return { isValid: false, error: 'Please enter a real major name (e.g., Computer Science, Business, Engineering).' }
  }
  
  return { isValid: true }
}

function validateModules(modules: string[]): { isValid: boolean; error?: string; validModules?: string[] } {
  const validModules: string[] = []
  
  for (const module of modules) {
    const cleanModule = module.trim().toUpperCase()
    
    // Check for inappropriate content
    for (const pattern of INAPPROPRIATE_PATTERNS) {
      if (pattern.test(cleanModule)) {
        return { isValid: false, error: 'Please enter real module codes. Inappropriate content is not allowed.' }
      }
    }
    
    // Check if it matches module patterns
    const isValidModule = MODULE_PATTERNS.some(pattern => pattern.test(cleanModule))
    
    if (isValidModule) {
      validModules.push(cleanModule)
    } else {
      return { 
        isValid: false, 
        error: `"${cleanModule}" doesn't look like a real module code. Please use format like CS2030S, ST2334, MA1101R.` 
      }
    }
  }
  
  return { isValid: true, validModules }
}

function validateDescription(description: string): { isValid: boolean; error?: string } {
  const cleanDesc = description.trim()
  
  // Check for inappropriate content
  for (const pattern of INAPPROPRIATE_PATTERNS) {
    if (pattern.test(cleanDesc)) {
      return { isValid: false, error: 'Please keep your description appropriate and study-related.' }
    }
  }
  
  // Check minimum length
  if (cleanDesc.length < 10) {
    return { isValid: false, error: 'Please write at least 10 characters describing your study style.' }
  }
  
  return { isValid: true }
}

function validateChatMessage(message: string): { isValid: boolean; error?: string; warning?: string } {
  const cleanMessage = message.trim().toLowerCase()
  
  // Check for harassment patterns
  for (const pattern of HARASSMENT_PATTERNS) {
    if (pattern.test(cleanMessage)) {
      return { 
        isValid: false, 
        error: '⚠️ This message contains inappropriate content. Please keep conversations respectful and study-focused. Use /endchat if you want to stop chatting.' 
      }
    }
  }
  
  // Check for warning patterns (less severe)
  for (const pattern of WARNING_PATTERNS) {
    if (pattern.test(cleanMessage)) {
      return { 
        isValid: true, 
        warning: '💡 Please keep conversations focused on studying. Avoid personal questions.' 
      }
    }
  }
  
  // Check for inappropriate content
  for (const pattern of INAPPROPRIATE_PATTERNS) {
    if (pattern.test(cleanMessage)) {
      return { 
        isValid: false, 
        error: '⚠️ This message contains inappropriate content. Please keep conversations respectful and study-focused.' 
      }
    }
  }
  
  return { isValid: true }
}

// ---------- helpers ----------
async function setUser(uid: string, data: Partial<UserDoc>) {
  try {
  await usersCol.doc(uid).set({ ...data, updatedAt: ts() }, { merge: true })
  } catch (error) {
    console.error('Error setting user data:', error)
    throw error
  }
}

function previewProfile(u: Partial<UserDoc>) {
  const g = u.gender ?? '—'
  const y = u.yearOfStudy ?? '—'
  const m = u.major ?? '—'
  const mods = (u.modules ?? []).join(', ') || '—'
  const meds = (u.mediums ?? []).join(', ') || '—'
  const d = (u.description ?? '').slice(0, 160) || '—'
  return `👤 Profile
• Gender: ${g}
• Year: ${y}
• Major: ${m}
• Modules: ${mods}
• Mediums: ${meds}
• Description: ${d}`
}

function checkProfileCompleteness(userData: Partial<UserDoc>) {
  const missing: string[] = []
  
  if (!userData.gender) missing.push('Gender')
  if (!userData.yearOfStudy) missing.push('Year of Study')
  if (!userData.major || userData.major.trim() === '') missing.push('Major')
  if (!userData.modules || userData.modules.length === 0) missing.push('Modules')
  
  return {
    isComplete: missing.length === 0,
    missingFields: missing
  }
}

function createMatchProfileDisplay(userData: any, matchScore: number) {
  const name = userData.name || 'Anonymous'
  const username = userData.handle ? `@${userData.handle}` : ''
  const gender = userData.gender || '—'
  const year = userData.yearOfStudy || '—'
  const major = userData.major || '—'
  const modules = (userData.modules || []).slice(0, 3).join(', ') + (userData.modules?.length > 3 ? '...' : '')
  const mediums = (userData.mediums || []).join(', ') || '—'
  const description = userData.description ? userData.description.slice(0, 100) + (userData.description.length > 100 ? '...' : '') : '—'
  
  return `🎯 Study Buddy Match Found!

👤 ${name} ${username}
📊 Match Score: ${matchScore.toFixed(2)}/10

📋 Profile:
• Gender: ${gender}
• Year: ${year}
• Major: ${major}
• Modules: ${modules}
• Mediums: ${mediums}
• Description: ${description}

Say hi and suggest a study time.`
}

// ---------- /start ----------
bot.start(async (ctx) => {
  try {
  const id = String(ctx.from.id)
  const snap = await usersCol.doc(id).get()
  if (!snap.exists) {
    const empty: UserDoc = {
      gender: null,
      yearOfStudy: null,
      major: null,
      modules: [],
      mediums: [],
      description: '',
      matchOptIn: true,
      blocked: [],
      timezone: 'Asia/Singapore'
    }
    await usersCol.doc(id).set({
      ...empty,
      handle: ctx.from.username ?? null,
      name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || null,
      createdAt: ts(),
      updatedAt: ts()
    })
    }
  } catch (error) {
    console.error('Error in /start command:', error)
    await ctx.reply('Sorry, there was an error setting up your profile. Please try again later.')
    return
  }

  await ctx.reply(
    'Welcome to Study Buddy! What would you like to do?',
    Markup.inlineKeyboard([
      [Markup.button.callback('🔍 Find Study Buddy', 'quick_find'), Markup.button.callback('💬 My Chats', 'quick_chats')],
      [Markup.button.callback('📝 Setup Profile', 'setup_profile'), Markup.button.callback('❓ Help', 'help')]
    ])
  )
})

bot.command('profile', async (ctx) => {
  try {
  const id = String(ctx.from.id)
  const doc = await usersCol.doc(id).get()
  const data = (doc.data() ?? {}) as Partial<UserDoc>
  await ctx.reply(previewProfile(data))
  } catch (error) {
    console.error('Error in /profile command:', error)
    await ctx.reply('Sorry, there was an error retrieving your profile. Please try again later.')
  }
})

bot.command('find', async (ctx) => {
  try {
    const myId = String(ctx.from.id)
    const meSnap = await usersCol.doc(myId).get()
    if (!meSnap.exists) return ctx.reply('Please /start to set up your profile first.')
    
    const me = meSnap.data() as UserDoc
    const completeness = checkProfileCompleteness(me)
    
    if (!completeness.isComplete) {
      const missingList = completeness.missingFields.map(field => `• ${field}`).join('\n')
      return ctx.reply(`❌ Please complete these required fields before finding a study buddy:\n\n${missingList}\n\nUse /start to fill in your profile!`)
    }
    
    // If profile is complete, proceed with matching logic
    await findStudyBuddy(ctx, me)
  } catch (error) {
    console.error('Error in /find command:', error)
    await ctx.reply('Sorry, there was an error finding a study buddy. Please try again later.')
  }
})

// ---------- Gender ----------
bot.action('p_gender', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply(
    'Select your gender:',
    Markup.inlineKeyboard([
      [Markup.button.callback('Male', 'g_male'), Markup.button.callback('Female', 'g_female')],
      [Markup.button.callback('Other', 'g_other'), Markup.button.callback('Prefer not to say', 'g_pnts')]
    ])
  )
})

const genderMap: Record<string, UserDoc['gender']> = {
  g_male: 'male',
  g_female: 'female',
  g_other: 'other',
  g_pnts: 'prefer_not_to_say'
}
for (const code of Object.keys(genderMap)) {
  bot.action(code, async (ctx) => {
    try {
    await setUser(String(ctx.from.id), { gender: genderMap[code] })
      await ctx.answerCbQuery() // Just acknowledge the button press
      await ctx.reply(`✅ Gender set to: ${genderMap[code]}`)
    } catch (error) {
      console.error('Error setting gender:', error)
      await ctx.answerCbQuery() // Just acknowledge the button press
      await ctx.reply('❌ Failed to save gender. Please try again.')
    }
  })
}

// ---------- Year ----------
bot.action('p_year', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply(
    'What is your year of study?',
    Markup.inlineKeyboard([[1, 2, 3, 4, 'other'].map((n) => Markup.button.callback(String(n), `y_${n}`))])
  )
})
for (const n of [1, 2, 3, 4] as const) {
  bot.action(`y_${n}`, async (ctx) => {
    try {
    await setUser(String(ctx.from.id), { yearOfStudy: n })
      await ctx.answerCbQuery() // Just acknowledge the button press
      await ctx.reply(`✅ Year ${n} saved`)
    } catch (error) {
      console.error('Error setting year:', error)
      await ctx.answerCbQuery() // Just acknowledge the button press
      await ctx.reply('❌ Failed to save year. Please try again.')
    }
  })
}

// Handle "other" year option
bot.action('y_other', async (ctx) => {
  try {
    await setUser(String(ctx.from.id), { yearOfStudy: 5 })
    await ctx.answerCbQuery() // Just acknowledge the button press
    await ctx.reply('✅ Year set to: Other (5+)')
  } catch (error) {
    console.error('Error setting year:', error)
    await ctx.answerCbQuery() // Just acknowledge the button press
    await ctx.reply('❌ Failed to save year. Please try again.')
  }
})

// ---------- Major ----------
bot.action('p_major', async (ctx) => {
  await ctx.answerCbQuery()
  userSessions.set(ctx.from.id, 'major')
  await ctx.reply('What is your major?')
})

// ---------- Modules ----------
bot.action('p_modules', async (ctx) => {
  await ctx.answerCbQuery()
  userSessions.set(ctx.from.id, 'modules')
  await ctx.reply('Send modules you want to study together as comma-separated values (e.g., CS2030S, ST2334)')
})

// ---------- Mediums ----------
bot.action('p_mediums', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply(
    'Choose preferred mediums:',
    Markup.inlineKeyboard([
      [Markup.button.callback('Online', 'm_toggle_online'), Markup.button.callback('IRL', 'm_toggle_irl')],
      [Markup.button.callback('Clear', 'm_clear')]
    ])
  )
})

async function toggleMedium(userId: string, key: Medium) {
  const ref = usersCol.doc(userId)
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    const curr = (snap.data()?.mediums ?? []) as Medium[]
    const has = curr.includes(key)
    const next = has ? curr.filter((x) => x !== key) : [...curr, key]
    t.set(ref, { mediums: next, updatedAt: ts() }, { merge: true })
  })
}
bot.action('m_toggle_online', async (ctx) => {
  try {
  await toggleMedium(String(ctx.from.id), 'online')
    await ctx.answerCbQuery() // Just acknowledge the button press
    await ctx.reply('✅ Online medium toggled')
  } catch (error) {
    console.error('Error toggling online medium:', error)
    await ctx.answerCbQuery() // Just acknowledge the button press
    await ctx.reply('❌ Failed to update medium. Please try again.')
  }
})
bot.action('m_toggle_irl', async (ctx) => {
  try {
  await toggleMedium(String(ctx.from.id), 'IRL')
    await ctx.answerCbQuery() // Just acknowledge the button press
    await ctx.reply('✅ IRL medium toggled')
  } catch (error) {
    console.error('Error toggling IRL medium:', error)
    await ctx.answerCbQuery() // Just acknowledge the button press
    await ctx.reply('❌ Failed to update medium. Please try again.')
  }
})
bot.action('m_clear', async (ctx) => {
  try {
  await setUser(String(ctx.from.id), { mediums: [] })
    await ctx.answerCbQuery() // Just acknowledge the button press
    await ctx.reply('✅ All mediums cleared')
  } catch (error) {
    console.error('Error clearing mediums:', error)
    await ctx.answerCbQuery() // Just acknowledge the button press
    await ctx.reply('❌ Failed to clear mediums. Please try again.')
  }
})

// ---------- Description ----------
bot.action('p_desc', async (ctx) => {
  await ctx.answerCbQuery()
  userSessions.set(ctx.from.id, 'description')
  await ctx.reply('Describe your study style, goals, expectations (1–3 sentences).')
})

// ---------- Find a buddy (uses description-aware matching) ----------
bot.action('find_now', async (ctx) => {
  await ctx.answerCbQuery()
  const myId = String(ctx.from.id)
  const meSnap = await usersCol.doc(myId).get()
  if (!meSnap.exists) return ctx.reply('Please /start to set up your profile first.')
  
  const me = meSnap.data() as UserDoc
  const completeness = checkProfileCompleteness(me)
  
  if (!completeness.isComplete) {
    const missingList = completeness.missingFields.map(field => `• ${field}`).join('\n')
    return ctx.reply(`❌ Please complete these required fields before finding a study buddy:\n\n${missingList}\n\nUse the buttons above to fill in your profile!`)
  }

  // If profile is complete, proceed with matching logic
  await findStudyBuddy(ctx, me)
})

// Quick action handlers
bot.action('quick_find', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply('🔍 Finding study buddies...')
  
  const myId = String(ctx.from.id)
  const meSnap = await usersCol.doc(myId).get()
  if (!meSnap.exists) return ctx.reply('Please /start to set up your profile first.')
  
  const me = meSnap.data() as UserDoc
  const completeness = checkProfileCompleteness(me)
  
  if (!completeness.isComplete) {
    const missingList = completeness.missingFields.map(field => `• ${field}`).join('\n')
    return ctx.reply(`❌ Please complete these required fields before finding a study buddy:\n\n${missingList}\n\nUse /profile to update your information.`)
  }
  
  await findStudyBuddy(ctx, me)
})

bot.action('quick_chats', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply('💬 Checking your chat sessions...')
  
  const userId = ctx.from.id
  const chatSession = tempChatSessions.get(userId)
  
  if (!chatSession) {
    await ctx.reply('You don\'t have any active chat sessions.\n\nUse /find to look for study buddies!')
    return
  }
  
  try {
    const otherUserId = chatSession.otherUserId
    const otherUserSnap = await usersCol.doc(otherUserId.toString()).get()
    const otherUserData = otherUserSnap.data()
    const otherUserName = otherUserData?.name || 'Anonymous'
    const otherUserHandle = otherUserData?.handle ? `@${otherUserData.handle}` : ''
    
    const { messageCount, lastMessageFrom } = chatSession
    const isActiveConversation = lastMessageFrom !== ctx.from.id
    const remaining = isActiveConversation ? 'Unlimited' : `${2 - messageCount} left`
    
    await ctx.reply(`💬 Active Chat Session

👤 Chatting with: ${otherUserName} ${otherUserHandle}
📊 Messages sent: ${messageCount}
🔄 Status: ${isActiveConversation ? 'Active' : 'Waiting for reply'}
📝 Messages remaining: ${remaining}

Use /endchat to end this conversation.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💬 Continue Chat', callback_data: `continue_chat_${otherUserId}` }],
          [{ text: '❌ End Chat', callback_data: `end_chat_${otherUserId}` }]
        ]
      }
    })
  } catch (error) {
    console.error('Error in quick_chats:', error)
    await ctx.reply('❌ Error retrieving chat information.')
  }
})

bot.action('setup_profile', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply(
    '📝 Profile Setup - Select what to update:',
    Markup.inlineKeyboard([
      [Markup.button.callback('Gender', 'p_gender'), Markup.button.callback('Year', 'p_year')],
      [Markup.button.callback('Major', 'p_major')],
      [Markup.button.callback('Modules', 'p_modules')],
      [Markup.button.callback('Mediums (online/IRL)', 'p_mediums')],
      [Markup.button.callback('Description (optional)', 'p_desc')],
      [Markup.button.callback('🔍 Find Study Buddy', 'quick_find')]
    ])
  )
})

bot.action('help', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply(`❓ Study Buddy Bot Help

🔍 /find - Find study buddies
💬 /chats - View active chat sessions
📝 /profile - View your profile
📊 /status - Check match status
📋 /examples - See valid input examples
🚨 /report - Report inappropriate behavior
❌ /endchat - End current chat session

💡 Quick Tips:
• Complete your profile for better matches
• You can send up to 2 messages before getting a reply
• Keep conversations study-focused and respectful
• Use /chats to manage multiple conversations

Need help? Contact support!`)
})

// Helper function for finding study buddy
async function findStudyBuddy(ctx: any, me: UserDoc) {
  const myId = String(ctx.from.id)

  const snaps = await usersCol.where('matchOptIn', '==', true).get()
  let best: { id: string; score: number } | null = null

  snaps.forEach((s) => {
    if (s.id === myId) return
    const other = s.data() as UserDoc & { blocked?: number[] }
    if ((me.blocked ?? []).includes(Number(s.id))) return
    if ((other.blocked ?? []).includes(Number(ctx.from.id))) return

    const score = scorePair(me, other)
    if (!best || score > best.score) {
      best = { id: s.id, score }
    }
  })

  if (!best || (best as { id: string; score: number }).score <= 1.5) {
    return ctx.reply('No strong matches yet. Try adding modules, mediums, or a richer description!')
  }

  const bestMatch = best as { id: string; score: number }
  
  // Get the matched user's profile data
  const matchedUserSnap = await usersCol.doc(bestMatch.id).get()
  const matchedUserData = matchedUserSnap.data()

  await matchesCol.add({
    users: [Number(ctx.from.id), Number(bestMatch.id)],
    score: bestMatch.score,
    status: 'intro_sent',
    messageCounts: { [ctx.from.id]: 0, [bestMatch.id]: 0 },
    lastMessageFrom: null,
    createdAt: ts()
  })

  // Show profile display with chat button
  const profileDisplay = createMatchProfileDisplay(matchedUserData, bestMatch.score)
  await ctx.reply(profileDisplay, Markup.inlineKeyboard([
    [Markup.button.callback('💬 Start Chat', `chat_${bestMatch.id}`)],
    [Markup.button.callback('❌ Not interested', `reject_${bestMatch.id}`)]
  ]))

  // Also notify the other user
  try {
    const myProfileDisplay = createMatchProfileDisplay(me, bestMatch.score)
    await ctx.telegram.sendMessage(
      Number(bestMatch.id),
      myProfileDisplay,
      Markup.inlineKeyboard([
        [Markup.button.callback('💬 Start Chat', `chat_${ctx.from.id}`)],
        [Markup.button.callback('❌ Not interested', `reject_${ctx.from.id}`)]
      ])
    )
  } catch {
    // ignore if the other user can't be messaged
  }
}

// ---------- Chat and Reject handlers ----------
bot.action(/^chat_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery()
  const otherUserId = parseInt(ctx.match[1])
  
  // Set up temporary chat session with message tracking
  tempChatSessions.set(ctx.from.id, {
    otherUserId: otherUserId,
    messageCount: 0,
    lastMessageFrom: 0
  })
  
  await ctx.reply('💬 Chat session started! You can send up to 2 messages.\n\nUse /chats to manage your chat session\nUse /endchat to end the chat\nUse /find to look for more study buddies')
  
  // Notify the other user
  try {
    const myName = ctx.from.first_name || 'Someone'
    await ctx.telegram.sendMessage(
      otherUserId,
      `💬 ${myName} started a chat with you! You can send up to 2 messages back.\n\nUse /chats to manage your chat session\nUse /endchat to end the chat\nUse /find to look for more study buddies`
    )
    tempChatSessions.set(otherUserId, {
      otherUserId: ctx.from.id,
      messageCount: 0,
      lastMessageFrom: 0
    })
  } catch {
    // ignore if the other user can't be messaged
  }
})

bot.action(/^reject_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery()
  const otherUserId = parseInt(ctx.match[1])
  
  await ctx.reply('❌ Match rejected. You can use /find to look for other study buddies.')
  
  // Notify the other user
  try {
    await ctx.telegram.sendMessage(
      otherUserId,
      '❌ The other user is not interested in this match. You can use /find to look for other study buddies.'
    )
  } catch {
    // ignore if the other user can't be messaged
  }
})

// ---------- Chat Management Commands ----------
bot.command('chats', async (ctx) => {
  const chatSession = tempChatSessions.get(ctx.from.id)
  if (chatSession) {
    const otherUserId = chatSession.otherUserId
    const { messageCount, lastMessageFrom } = chatSession
    
    // Get other user's info
    try {
      const otherUserSnap = await usersCol.doc(String(otherUserId)).get()
      const otherUserData = otherUserSnap.data()
      const otherUserName = otherUserData?.name || 'Anonymous'
      const otherUserHandle = otherUserData?.handle ? `@${otherUserData.handle}` : ''
      
      const isActiveConversation = lastMessageFrom !== ctx.from.id
      const remaining = isActiveConversation ? 'Unlimited' : `${2 - messageCount} left`
      
      await ctx.reply(`💬 Active Chat Session

👤 Chatting with: ${otherUserName} ${otherUserHandle}
📊 Messages sent: ${messageCount}
🔄 Status: ${isActiveConversation ? 'Active' : 'Waiting for reply'}
📝 Messages remaining: ${remaining}

Use /endchat to end this session
Use /find to look for more study buddies`, 
        Markup.inlineKeyboard([
          [Markup.button.callback('💬 Continue Chat', `continue_chat_${otherUserId}`)],
          [Markup.button.callback('❌ End Chat', `end_chat_${otherUserId}`)]
        ])
      )
    } catch (error) {
      await ctx.reply('❌ Error retrieving chat information.')
    }
  } else {
    await ctx.reply('❌ You are not currently in any chat session. Use /find to look for study buddies!')
  }
})

bot.command('endchat', async (ctx) => {
  const chatSession = tempChatSessions.get(ctx.from.id)
  if (chatSession) {
    const otherUserId = chatSession.otherUserId
    tempChatSessions.delete(ctx.from.id)
    tempChatSessions.delete(otherUserId)
    await ctx.reply('💬 Chat session ended. Use /find to look for other study buddies.')
    
    // Notify the other user
    try {
      await ctx.telegram.sendMessage(
        otherUserId,
        '💬 Chat session ended by the other user.'
      )
    } catch {
      // ignore if the other user can't be messaged
    }
  } else {
    await ctx.reply('❌ You are not currently in a chat session.')
  }
})

bot.command('delete', async (ctx) => {
    try {
      const userId = ctx.from.id
      const userIdStr = String(userId)
      
      // Confirm deletion with user
      await ctx.reply('⚠️ Are you sure you want to delete ALL your data?\n\nThis will permanently remove:\n• Your profile information\n• Your match history\n• All chat sessions\n• Your preferences\n\nThis action cannot be undone!', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Yes, Delete Everything', callback_data: 'confirm_delete' }],
            [{ text: '❌ Cancel', callback_data: 'cancel_delete' }]
          ]
        }
      })
    } catch (error) {
      console.error('Error in delete command:', error)
      await ctx.reply('❌ Sorry, there was an error. Please try again.')
    }
  })
  
  // Handle delete confirmation
  bot.action('confirm_delete', async (ctx) => {
    await ctx.answerCbQuery()
    const userId = ctx.from.id
    const userIdStr = String(userId)
    
    try {
      // Delete user document
      await usersCol.doc(userIdStr).delete()
      
      // Delete any matches involving this user
      const matchesQuery = matchesCol.where('users', 'array-contains', userId)
      const matchesSnapshot = await matchesQuery.get()
      
      const batch = db.batch()
      matchesSnapshot.forEach(doc => {
        batch.delete(doc.ref)
      })
      await batch.commit()
      
      // Clear any active chat sessions
      tempChatSessions.delete(userId)
      
      // Clear any user sessions
      userSessions.delete(userId)
      
      await ctx.reply('🧹 Your data has been completely deleted.\n\n• Profile removed\n• Match history cleared\n• Chat sessions ended\n• All preferences reset\n\nThank you for using Study Buddy!')
      
    } catch (error) {
      console.error('Error deleting user data:', error)
      await ctx.reply('❌ There was an error deleting your data. Please try again or contact support.')
    }
  })
  
  bot.action('cancel_delete', async (ctx) => {
    await ctx.answerCbQuery()
    await ctx.reply('✅ Deletion cancelled. Your data is safe!')
  })
  
  bot.command('menu', async (ctx) => {
    await ctx.reply(
      '🏠 Main Menu - What would you like to do?',
      Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Find Study Buddy', 'quick_find'), Markup.button.callback('💬 My Chats', 'quick_chats')],
        [Markup.button.callback('📝 Setup Profile', 'setup_profile'), Markup.button.callback('❓ Help', 'help')]
      ])
    )
  })
  
  bot.command('help', async (ctx) => {
    try {
      await ctx.reply('🤖 Study Buddy Bot Commands\n\n🏠 Quick Access:\n/menu - Main menu with quick action buttons\n/start - Welcome message and setup\n\n📋 Profile Management:\n/profile - View your current profile\n/delete - Delete all your data (with confirmation)\n\n🔍 Finding Study Buddies:\n/find - Find a study buddy (requires complete profile)\n/status - Check your current match status\n\n💬 Chat Management:\n/chats - View and manage your active chat session\n/endchat - End your current chat session\n\n⚙️ Account Management:\n/stop - Pause matching (you won\'t appear in searches)\n\n📋 Additional Commands:\n/examples - See valid input examples\n/report - Report inappropriate behavior\n\n💡 Tips:\n• Complete your profile (gender, year, major, modules) before finding buddies\n• You can find multiple study buddies while maintaining chat sessions\n• Use /chats to check your chat status anytime\n• Chat sessions have a 2-message limit until the other person replies')
    } catch (error) {
      console.error('Error in help command:', error)
      await ctx.reply('❌ Sorry, there was an error with the help command.')
    }
  })
  
  bot.command('examples', async (ctx) => {
    await ctx.reply(`📚 Valid Examples
  
  🎓 Majors:
  • Computer Science, CS
  • Business Administration, BA
  • Mechanical Engineering, ME
  • Mathematics, Math
  • Psychology, Economics
  
  📖 Modules:
  • CS2030S, ST2334, MA1101R
  • CS203, ST233, MA110
  • CS20, ST23, MA11
  
  ✅ Tips:
  • Use real major names (not made-up ones)
  • Module codes should follow university format
  • Keep descriptions study-related and appropriate
  • Minimum 10 characters for descriptions`)
  })
  
  bot.command('report', async (ctx) => {
    try {
      await ctx.reply('🚨 Report Inappropriate Behavior\n\nIf someone is being inappropriate, harassing you, or asking for personal information:\n\n1. Use /endchat to end the conversation immediately\n2. Block the user if necessary\n3. Contact the bot administrator if the behavior is severe\n\n✅ Appropriate topics:\n• Study materials and resources\n• Course content and assignments\n• Study schedules and methods\n• Academic discussions\n\n❌ Inappropriate topics:\n• Personal information requests\n• Harassment or bullying\n• Sexual or romantic advances\n• Requests for money or favors\n• Academic dishonesty (cheating)\n\nRemember: This is a study-focused platform. Keep conversations respectful and academic!')
    } catch (error) {
      console.error('Error in report command:', error)
      await ctx.reply('❌ Sorry, there was an error with the report command.')
    }
  })
  

// Button handlers for chat management
bot.action(/^continue_chat_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.reply('💬 You can now send messages to continue your chat. Type /chats to check your chat status anytime.')
})

bot.action(/^end_chat_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery()
  const otherUserId = parseInt(ctx.match[1])
  
  // End the chat session
  tempChatSessions.delete(ctx.from.id)
  tempChatSessions.delete(otherUserId)
  
  await ctx.reply('💬 Chat session ended. Use /find to look for other study buddies.')
  
  // Notify the other user
  try {
    await ctx.telegram.sendMessage(
      otherUserId,
      '💬 Chat session ended by the other user.'
    )
  } catch {
    // ignore if the other user can't be messaged
  }
})

// ---------- Text input handler for profile updates ----------
bot.on('text', async (ctx) => {
  const userId = ctx.from.id
  const messageText = ctx.message.text

  // Check if this is a command (starts with /)
  if (messageText.startsWith('/')) {
    return // Let command handlers deal with it
  }

  // Check if user is in a temporary chat session
  const chatSession = tempChatSessions.get(userId)
  if (chatSession) {
    const { otherUserId, messageCount, lastMessageFrom } = chatSession
    
    // Check if conversation is active (other user has replied)
    const otherUserSession = tempChatSessions.get(otherUserId)
    const isActiveConversation = otherUserSession && otherUserSession.messageCount > 0
    
    // If conversation is not active and this user is trying to send another message
    if (!isActiveConversation && lastMessageFrom === userId) {
      if (messageCount >= 2) {
        await ctx.reply('⚠️ You\'ve reached the limit of 2 messages. Wait for a reply from your study buddy!')
        return
      }
    }
    
    // Validate chat message
    const validation = validateChatMessage(messageText)
    if (!validation.isValid) {
      await ctx.reply(validation.error!)
      return
    }
    
    try {
      const myName = ctx.from.first_name || 'Someone'
      await ctx.telegram.sendMessage(
        otherUserId,
        `💬 From ${myName}:\n\n${messageText}`
      )
      
      // Update message count and last message sender
      chatSession.messageCount += 1
      chatSession.lastMessageFrom = userId
      tempChatSessions.set(userId, chatSession)
      
      if (!isActiveConversation) {
        const remaining = 2 - messageCount
        let response = `✅ Message sent! ${remaining > 0 ? `You can send ${remaining} more message(s).` : 'Wait for a reply!'}`
        if (validation.warning) {
          response += `\n\n${validation.warning}`
        }
        await ctx.reply(response)
      } else {
        let response = '✅ Message sent!'
        if (validation.warning) {
          response += `\n\n${validation.warning}`
        }
        await ctx.reply(response)
      }
    } catch (error) {
      await ctx.reply('❌ Failed to send message. The other user might have ended the chat.')
      tempChatSessions.delete(userId)
      tempChatSessions.delete(otherUserId)
    }
    return
  }

  // Check if user is in a profile input session
  const session = userSessions.get(userId)
  if (session) {
    userSessions.delete(userId) // Clear the session
    
    try {
      switch (session) {
        case 'major': {
          const major = messageText.trim()
          if (major.length === 0) {
            await ctx.reply('❌ Major cannot be empty. Please try again.')
            return
          }
          
          const validation = validateMajor(major)
          if (!validation.isValid) {
            await ctx.reply(`❌ ${validation.error}`)
            return
          }
          
          await setUser(String(userId), { major })
          await ctx.reply(`✅ Major saved: ${major}`)
          break
        }
        case 'modules': {
          const mods = messageText.split(',').map((s: string) => s.trim()).filter(Boolean)
          if (mods.length === 0) {
            await ctx.reply('❌ Please enter at least one module. Try again.')
            return
          }
          
          const validation = validateModules(mods)
          if (!validation.isValid) {
            await ctx.reply(`❌ ${validation.error}`)
            return
          }
          
          await setUser(String(userId), { modules: validation.validModules! })
          await ctx.reply(`✅ ${validation.validModules!.length} module(s) saved: ${validation.validModules!.join(', ')}`)
          break
        }
        case 'description': {
          const text = messageText.trim().slice(0, 600)
          if (text.length === 0) {
            await ctx.reply('❌ Description cannot be empty. Please try again.')
            return
          }
          
          const validation = validateDescription(text)
          if (!validation.isValid) {
            await ctx.reply(`❌ ${validation.error}`)
            return
          }
          
          await setUser(String(userId), { description: text })
          await ctx.reply(`✅ Description saved: ${text}`)
          break
        }
      }
    } catch (error) {
      console.error(`Error setting ${session}:`, error)
      await ctx.reply(`❌ Failed to save ${session}. Please try again.`)
    }
    return
  }

  // If not in a profile session or temp chat, check for message forwarding
  await handleMessageForwarding(ctx)
})

// ---------- Message tracking and limiting ----------
async function handleMessageForwarding(ctx: any) {
  const userId = ctx.from.id
  const messageText = ctx.message.text

  // Find active match for this user
  const matchQuery = await matchesCol
    .where('users', 'array-contains', userId)
    .where('status', 'in', ['intro_sent', 'active'])
    .limit(1)
    .get()

  if (matchQuery.empty) {
    return // No active match, ignore the message
  }

  const matchDoc = matchQuery.docs[0]
  const matchData = matchDoc.data()
  const otherUserId = matchData.users.find((id: number) => id !== userId)
  const messageCounts = matchData.messageCounts || { [userId]: 0, [otherUserId]: 0 }
  const lastMessageFrom = matchData.lastMessageFrom

  // Check if the other user has replied (conversation is active)
  const isActiveConversation = matchData.status === 'active'
  
  // If conversation is not active and this user is trying to send another message
  if (!isActiveConversation && lastMessageFrom === userId) {
    const userMessageCount = messageCounts[userId] || 0
    
    if (userMessageCount >= 2) {
      await ctx.reply('⚠️You\'ve reached the limit of 2 messages. Wait for a reply from your study buddy!')
      return
    }
  }

  // Update message count for this user
  const newMessageCounts = {
    ...messageCounts,
    [userId]: (messageCounts[userId] || 0) + 1
  }

  // Update match document
  await matchDoc.ref.update({
    messageCounts: newMessageCounts,
    lastMessageFrom: userId,
    status: isActiveConversation ? 'active' : 'intro_sent',
    updatedAt: ts()
  })

  // Validate message before forwarding
  const validation = validateChatMessage(messageText)
  if (!validation.isValid) {
    await ctx.reply(validation.error!)
    return
  }
  
  // Forward the message to the other user
  try {
    await ctx.telegram.sendMessage(
      otherUserId,
      `📩 From your study buddy:\n\n${messageText}`
    )
    
    if (!isActiveConversation) {
      let response = 'Message sent! This is your first message to your study buddy.'
      if (validation.warning) {
        response += `\n\n${validation.warning}`
      }
      await ctx.reply(response)
    } else {
      if (validation.warning) {
        await ctx.reply(validation.warning)
      }
    }
  } catch (error) {
    await ctx.reply('Sorry, I couldn\'t deliver your message. The other user might have blocked the bot.')
  }
}

// ---------- Data controls ----------
bot.command('stop', async (ctx) => {
  await setUser(String(ctx.from.id), { matchOptIn: false })
  await ctx.reply('You\'ve paused matching. Use /start to resume and edit profile.')
})

bot.command('status', async (ctx) => {
  const userId = ctx.from.id
  
  // Check for active matches
  const matchQuery = await matchesCol
    .where('users', 'array-contains', userId)
    .where('status', 'in', ['intro_sent', 'active'])
    .limit(1)
    .get()

  if (matchQuery.empty) {
    await ctx.reply('You don\'t have any active study buddy matches. Use /start to find one!')
    return
  }

  const matchDoc = matchQuery.docs[0]
  const matchData = matchDoc.data()
  const otherUserId = matchData.users.find((id: number) => id !== userId)
  const messageCounts = matchData.messageCounts || { [userId]: 0, [otherUserId]: 0 }
  const lastMessageFrom = matchData.lastMessageFrom
  const isActiveConversation = matchData.status === 'active'
  
  const userMessageCount = messageCounts[userId] || 0
  const otherMessageCount = messageCounts[otherUserId] || 0
  
  let statusMessage = `📊 Match Status:\n\n`
  statusMessage += `• Match Score: ${matchData.score.toFixed(2)}\n`
  statusMessage += `• Conversation: ${isActiveConversation ? 'Active' : 'Waiting for reply'}\n`
  statusMessage += `• Your messages: ${userMessageCount}/2\n`
  statusMessage += `• Their messages: ${otherMessageCount}\n\n`
  
  if (!isActiveConversation && lastMessageFrom === userId && userMessageCount >= 2) {
    statusMessage += `⚠️ You've reached the 2-message limit. Wait for a reply!`
  } else if (!isActiveConversation && lastMessageFrom === userId) {
    statusMessage += `💬 You can send ${2 - userMessageCount} more message(s) before waiting for a reply.`
  } else if (isActiveConversation) {
    statusMessage += `✅ Conversation is active - no message limits!`
  } else {
    statusMessage += `📩 Waiting for your study buddy to start the conversation.`
  }
  
  await ctx.reply(statusMessage)
})


// ---------- boot ----------
bot.launch()
console.log('Study Buddy bot running.')

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
