// monitor-restaurants.js
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Monitor for new restaurant submissions
function monitorRestaurants() {
  console.log("👀 Monitoring for new restaurant submissions...");

  const usersRef = db.collection("users");

  // Listen for real-time changes
  usersRef
    .where("role", "==", "vendor")
    .where("type", "==", "restaurant")
    .where("certification.status", "==", "under_review")
    .onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const data = change.doc.data();
          console.log("\n🚨 NEW RESTAURANT SUBMISSION!");
          console.log(`🏪 ${data.name} ${data.lastName}`);
          console.log(`📧 ${data.email}`);
          console.log(`📅 ${new Date().toLocaleString()}`);
          console.log(`🆔 ${change.doc.id}`);
          console.log("📋 Run: node verify-restaurants.js\n");
        }
      });
    });
}

monitorRestaurants();
