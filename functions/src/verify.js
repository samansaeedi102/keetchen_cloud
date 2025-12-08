const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // or use serviceAccountKey.json
});

// List of user UIDs to verify
const userUids = ["DF4UaOKoCeNTS04AmwiCd7RhJ7l1"];

async function verifyUsers() {
  for (const uid of userUids) {
    try {
      await admin.auth().updateUser(uid, { emailVerified: true });
      console.log(`Verified user: ${uid}`);
    } catch (err) {
      console.error(`Failed to verify user ${uid}:`, err);
    }
  }
  process.exit();
}

verifyUsers();
