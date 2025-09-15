import * as admin from 'firebase-admin'
import * as path from 'path'

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '../service-account.json')
  
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
      projectId: 'nus-study-buddy'
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
