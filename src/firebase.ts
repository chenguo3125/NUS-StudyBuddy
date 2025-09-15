import * as admin from 'firebase-admin'
import * as path from 'path'

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  try {
    let credential;
    
    // Check if we have service account credentials as environment variables (for production)
    if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
      console.log('Using Firebase credentials from environment variables')
      credential = admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID || 'nus-study-buddy',
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      })
    } else {
      // Fallback to service account file (for local development)
      const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '../service-account.json')
      console.log('Using Firebase credentials from file:', serviceAccountPath)
      credential = admin.credential.cert(serviceAccountPath)
    }
    
    admin.initializeApp({
      credential: credential,
      projectId: process.env.FIREBASE_PROJECT_ID || 'nus-study-buddy'
    })
    console.log('Firebase Admin SDK initialized successfully')
  } catch (error) {
    console.error('Error initializing Firebase Admin SDK:', error)
    throw error
  }
}

export const db = admin.firestore()

// Test the connection
db.settings({
  ignoreUndefinedProperties: true
})

export const usersCol = db.collection('users')
export const matchesCol = db.collection('matches')

// Test database connection
async function testConnection() {
  try {
    await db.collection('_test').doc('_test').get()
    console.log('Firestore connection test successful')
  } catch (error) {
    console.error('Firestore connection test failed:', error)
  }
}

testConnection()
