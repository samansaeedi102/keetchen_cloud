const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// /**
//  * APPROVE RESTAURANT
//  * @param {string} restaurantId - Restaurant's user ID
//  * @param {string} adminId - Admin who approved (optional, defaults to "admin")
//  */
// async function approveRestaurant(restaurantId, adminId = "admin") {
//   try {
//     console.log(`🔄 Approving restaurant: ${restaurantId}`);

//     const restaurantRef = db.collection("users").doc(restaurantId);

//     await restaurantRef.update({
//       "certification.status": "certified",
//       "certification.verifiedAt": new Date().toISOString(), // ✅ Use string instead of serverTimestamp
//       "certification.verifiedBy": adminId,
//       "certification.rejectionReason": admin.firestore.FieldValue.delete(),
//       "certification.notes": "Restaurant approved by admin",
//     });

//     console.log(`✅ Restaurant ${restaurantId} approved successfully!`);
//     return { success: true, message: "Restaurant approved successfully" };
//   } catch (error) {
//     console.error(`❌ Failed to approve restaurant ${restaurantId}:`, error);
//     throw error;
//   }
// }

/**
 * APPROVE RESTAURANT
 * @param {string} restaurantId - Restaurant's user ID
 * @param {string} adminId - Admin who approved (optional, defaults to "admin")
 */
async function approveRestaurant(restaurantId, adminId = "admin") {
  try {
    console.log(`🔄 Approving restaurant: ${restaurantId}`);

    const restaurantRef = db.collection("users").doc(restaurantId);

    await restaurantRef.update({
      "certification.status": "certified",
      "certification.documentsStatus": "approved", // ✅ ADD THIS LINE
      "certification.verifiedAt": new Date().toISOString(),
      "certification.verifiedBy": adminId,
      "certification.rejectionReason": admin.firestore.FieldValue.delete(),
      "certification.notes": "Restaurant approved by admin",
    });

    console.log(`✅ Restaurant ${restaurantId} approved successfully!`);
    return { success: true, message: "Restaurant approved successfully" };
  } catch (error) {
    console.error(`❌ Failed to approve restaurant ${restaurantId}:`, error);
    throw error;
  }
}

// /**
//  * REJECT RESTAURANT
//  * @param {string} restaurantId - Restaurant's user ID
//  * @param {string} rejectionReason - Reason for rejection (shown to restaurant)
//  * @param {string} adminId - Admin who rejected (optional, defaults to "admin")
//  */
// async function rejectRestaurant(
//   restaurantId,
//   rejectionReason,
//   adminId = "admin"
// ) {
//   try {
//     if (!rejectionReason || rejectionReason.trim() === "") {
//       throw new Error("Rejection reason is required");
//     }

//     console.log(`🔄 Rejecting restaurant: ${restaurantId}`);
//     console.log(`📝 Reason: ${rejectionReason}`);

//     const restaurantRef = db.collection("users").doc(restaurantId);

//     await restaurantRef.update({
//       "certification.status": "rejected",
//       "certification.rejectionReason": rejectionReason.trim(),
//       "certification.verifiedAt": new Date().toISOString(), // ✅ Use string instead of serverTimestamp
//       "certification.verifiedBy": adminId,
//     });

//     console.log(`❌ Restaurant ${restaurantId} rejected: ${rejectionReason}`);
//     return { success: true, message: "Restaurant rejected successfully" };
//   } catch (error) {
//     console.error(`❌ Failed to reject restaurant ${restaurantId}:`, error);
//     throw error;
//   }
// }

/**
 * REJECT RESTAURANT
 * @param {string} restaurantId - Restaurant's user ID
 * @param {string} rejectionReason - Reason for rejection (shown to restaurant)
 * @param {string} adminId - Admin who rejected (optional, defaults to "admin")
 */
async function rejectRestaurant(
  restaurantId,
  rejectionReason,
  adminId = "admin"
) {
  try {
    if (!rejectionReason || rejectionReason.trim() === "") {
      throw new Error("Rejection reason is required");
    }

    console.log(`🔄 Rejecting restaurant: ${restaurantId}`);
    console.log(`📝 Reason: ${rejectionReason}`);

    const restaurantRef = db.collection("users").doc(restaurantId);

    await restaurantRef.update({
      "certification.status": "rejected",
      "certification.documentsStatus": "rejected", // ✅ ADD THIS LINE
      "certification.rejectionReason": rejectionReason.trim(),
      "certification.verifiedAt": new Date().toISOString(),
      "certification.verifiedBy": adminId,
    });

    console.log(`❌ Restaurant ${restaurantId} rejected: ${rejectionReason}`);
    return { success: true, message: "Restaurant rejected successfully" };
  } catch (error) {
    console.error(`❌ Failed to reject restaurant ${restaurantId}:`, error);
    throw error;
  }
}
/**
 * GET RESTAURANT DETAILS BY ID
 * @param {string} restaurantId - Restaurant's user ID
 */
async function getRestaurantDetails(restaurantId) {
  try {
    const restaurantDoc = await db.collection("users").doc(restaurantId).get();

    if (!restaurantDoc.exists()) {
      throw new Error("Restaurant not found");
    }

    const data = restaurantDoc.data();

    return {
      id: restaurantId,
      name: `${data.name} ${data.lastName}`,
      email: data.email,
      phone: data.phone,
      location: data.location,
      description: data.description,
      certification: data.certification,
      submittedAt: data.certification?.documentsSubmittedAt,
      businessLicenseUrl: data.certification?.businessLicenseUrl,
      sanitaryCertificationUrl: data.certification?.sanitaryCertificationUrl,
      workPermitUrl: data.certification?.workPermitUrl,
    };
  } catch (error) {
    console.error(`❌ Error fetching restaurant ${restaurantId}:`, error);
    throw error;
  }
}

/**
 * LIST ALL RESTAURANTS UNDER REVIEW
 */
async function listPendingRestaurants() {
  try {
    console.log("📋 Fetching restaurants under review...\n");

    const snapshot = await db
      .collection("users")
      .where("role", "==", "vendor")
      .where("type", "==", "restaurant")
      .where("certification.status", "==", "under_review")
      .get();

    if (snapshot.empty) {
      console.log("✅ No restaurants pending approval.");
      return [];
    }

    const restaurants = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      restaurants.push({
        id: doc.id,
        name: `${data.name} ${data.lastName}`,
        email: data.email,
        phone: data.phone,
        location: data.location,
        description: data.description,
        submittedAt: data.certification?.documentsSubmittedAt,
        businessLicenseUrl: data.certification?.businessLicenseUrl,
        sanitaryCertificationUrl: data.certification?.sanitaryCertificationUrl,
        workPermitUrl: data.certification?.workPermitUrl,
      });
    });

    console.log(`Found ${restaurants.length} restaurant(s) under review:\n`);

    restaurants.forEach((restaurant, index) => {
      console.log(`${index + 1}. 🏪 ${restaurant.name}`);
      console.log(`   📧 ${restaurant.email}`);
      console.log(`   📱 ${restaurant.phone}`);
      console.log(
        `   📍 ${restaurant.location?.city}, ${restaurant.location?.country}`
      );
      console.log(`   📅 ${new Date(restaurant.submittedAt).toLocaleString()}`);
      console.log(`   🆔 ID: ${restaurant.id}`);
      console.log(`   🔗 Business: ${restaurant.businessLicenseUrl}`);
      console.log(`   🔗 Sanitary: ${restaurant.sanitaryCertificationUrl}`);
      console.log(`   🔗 Work: ${restaurant.workPermitUrl}`);
      console.log("");
    });

    return restaurants;
  } catch (error) {
    console.error("❌ Error fetching pending restaurants:", error);
    throw error;
  }
}

/**
 * APPROVE VENDOR SUBSCRIPTION PAYMENT
 * @param {string} receiptId - Firestore doc ID of the subscriptionPayments receipt
 * @param {number|string} menuSlots - Number of slots to allocate (5, 15, or 'unlimited')
 * @param {string} adminId - Admin who approved (optional, defaults to "admin")
 */
// async function approveVendorSubscription(
//   receiptId,
//   menuSlots,
//   adminId = "admin"
// ) {
//   try {
//     console.log(`🔄 Approving vendor subscription receipt: ${receiptId}`);

//     // 1. Update the receipt status to 'approved'
//     const receiptRef = db.collection("subscriptionPayments").doc(receiptId);
//     await receiptRef.update({
//       status: "approved",
//       reviewedAt: new Date().toISOString(),
//       reviewedBy: adminId,
//     });

//     // 2. Get the vendorId from the receipt
//     const receiptDoc = await receiptRef.get();
//     const vendorId = receiptDoc.data()?.vendorId;
//     if (!vendorId) throw new Error("Vendor ID not found in receipt!");

//     // 3. Update the vendor's menuSlots
//     await db
//       .collection("users")
//       .doc(vendorId)
//       .update({
//         menuSlots: menuSlots === "unlimited" ? -1 : Number(menuSlots),
//       });

//     console.log(
//       `✅ Vendor ${vendorId} subscription approved! Allocated slots: ${menuSlots}`
//     );
//     return { success: true, message: "Vendor subscription approved" };
//   } catch (error) {
//     console.error(`❌ Failed to approve vendor subscription:`, error);
//     throw error;
//   }
// }

async function approveVendorSubscription(
  receiptId,
  menuSlots,
  adminId = "admin"
) {
  try {
    console.log(`🔄 Approving vendor subscription receipt: ${receiptId}`);

    // 1. Update the receipt status to 'approved'
    const receiptRef = db.collection("subscriptionPayments").doc(receiptId);
    await receiptRef.update({
      status: "approved",
      reviewedAt: new Date().toISOString(),
      reviewedBy: adminId,
    });

    // 2. Get the vendorId and creditsUsed from the receipt
    const receiptDoc = await receiptRef.get();
    const data = receiptDoc.data();
    const vendorId = data?.vendorId;
    const creditsUsed = data?.creditsUsed ?? 0;
    if (!vendorId) throw new Error("Vendor ID not found in receipt!");

    // 3. Update the vendor's menuSlots
    await db
      .collection("users")
      .doc(vendorId)
      .update({
        menuSlots: menuSlots === "unlimited" ? -1 : Number(menuSlots),
      });

    // 4. Deduct credits from vendor
    if (creditsUsed > 0) {
      await db
        .collection("users")
        .doc(vendorId)
        .update({
          credits: admin.firestore.FieldValue.increment(-creditsUsed),
        });
      console.log(`✅ Deducted ${creditsUsed} credits from vendor ${vendorId}`);
    }

    console.log(
      `✅ Vendor ${vendorId} subscription approved! Allocated slots: ${menuSlots}, Deducted credits: ${creditsUsed}`
    );
    return { success: true, message: "Vendor subscription approved" };
  } catch (error) {
    console.error(`❌ Failed to approve vendor subscription:`, error);
    throw error;
  }
}
/**
 * REJECT VENDOR SUBSCRIPTION PAYMENT
 * @param {string} receiptId - Firestore doc ID of the subscriptionPayments receipt
 * @param {string} rejectionReason - Reason for rejection
 * @param {string} adminId - Admin who rejected (optional, defaults to "admin")
 */
async function rejectVendorSubscription(
  receiptId,
  rejectionReason,
  adminId = "admin"
) {
  try {
    if (!rejectionReason || rejectionReason.trim() === "") {
      throw new Error("Rejection reason is required");
    }

    console.log(`🔄 Rejecting vendor subscription receipt: ${receiptId}`);
    console.log(`📝 Reason: ${rejectionReason}`);

    // 1. Update the receipt status to 'rejected'
    const receiptRef = db.collection("subscriptionPayments").doc(receiptId);
    await receiptRef.update({
      status: "rejected",
      rejectionReason: rejectionReason.trim(),
      reviewedAt: new Date().toISOString(),
      reviewedBy: adminId,
    });

    console.log(
      `❌ Vendor subscription receipt ${receiptId} rejected: ${rejectionReason}`
    );
    return { success: true, message: "Vendor subscription rejected" };
  } catch (error) {
    console.error(`❌ Failed to reject vendor subscription:`, error);
    throw error;
  }
}

// Export functions
module.exports = {
  approveRestaurant,
  rejectRestaurant,
  getRestaurantDetails,
  listPendingRestaurants,
  approveVendorSubscription,
  rejectVendorSubscription,
};

// Example usage when run directly
if (require.main === module) {
  console.log("🔥 KEETCHEN RESTAURANT ADMIN VERIFICATION\n");
  console.log("Available functions:");
  console.log("- approveRestaurant(restaurantId)");
  console.log("- rejectRestaurant(restaurantId, reason)");
  console.log("- getRestaurantDetails(restaurantId)");
  console.log("- listPendingRestaurants()");
  console.log("\nExample usage:");
  console.log('approveRestaurant("dWCdplUpryeSyid7F8uOc4PTRIy1")');
  console.log(
    'rejectRestaurant("dWCdplUpryeSyid7F8uOc4PTRIy1", "Business license expired")'
  );
  console.log("");
  console.log("- approveVendorSubscription(receiptId, menuSlots, adminId)");
  console.log(
    "- rejectVendorSubscription(receiptId, rejectionReason, adminId)"
  );
  console.log("");

  // List pending restaurants when script is run
  listPendingRestaurants()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Script failed:", error);
      process.exit(1);
    });
}

//node -e "require('./verify-restaurants.js').approveRestaurant('	tRGB86RrEyMvi3iMCoq9O4md45m2')"
//node -e "require('./verify-restaurants.js').rejectRestaurant('dWCdplUpryeSyid7F8uOc4PTRIy1', 'Business license expired - please upload a valid license')"
//Invalid documents
//node -e "require('./verify-restaurants.js').rejectRestaurant('dWCdplUpryeSyid7F8uOc4PTRIy1', 'Documents are not clear - please upload higher quality images')"

//Missing sanitary certification
//node -e "require('./verify-restaurants.js').rejectRestaurant('kDLMw0CVVPTMP7QW7H1h9i5QoEz2', 'Sanitary certification appears to be expired')"

// Work permit issues
//node -e "require('./verify-restaurants.js').rejectRestaurant('6tMIUnIC9mQ7t9GsF9mC7xVMbCa2', 'Work permit is not readable - please upload a clearer document')"

// Address mismatch
//node -e "require('./verify-restaurants.js').rejectRestaurant('dWCdplUpryeSyid7F8uOc4PTRIy1', 'Restaurant address does not match business license address')"

// Example: Approve
// node -e "require('./verify-restaurants.js').approveVendorSubscription('RECEIPT_ID', 5)"
// node -e "require('./verify-restaurants.js').approveVendorSubscription('RECEIPT_ID', 'unlimited')"
// node -e "require('./verify-restaurants.js').approveVendorSubscription('q8Qo043fmWmD89ZT3uuw', 5)"
// node -e "require('./verify-restaurants.js').approveVendorSubscription('YaQBuUZ1lZCMhbhoFP6x', 15)"
// node -e "require('./verify-restaurants.js').approveVendorSubscription('RECEIPT_ID', 'unlimited')"
// Example: Reject
// node -e "require('./verify-restaurants.js').rejectVendorSubscription('RECEIPT_ID', 'Payment not found')"
//node -e "require('./verify-restaurants.js').rejectVendorSubscription('RECEIPT_ID', 'Payment not found')"
