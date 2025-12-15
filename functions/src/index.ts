import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
const nodemailer = require("nodemailer");

admin.initializeApp();

async function shouldSendNotification(
  userId: string,
  notificationType: string | number
) {
  try {
    // ✅ MANDATORY NOTIFICATIONS - Always send these
    const mandatoryNotifications = [
      "orderAccepted",
      "orderRejected",
      "orderDelivered",
      "newOrder",
      "referral",
      "referral_pending",
    ];

    // Always send mandatory notifications
    if (mandatoryNotifications.includes(notificationType as string)) {
      console.log(`Sending mandatory notification: ${notificationType}`);
      return true;
    }

    // For optional notifications, check user preferences
    const userDoc = await admin
      .firestore()
      .collection("users")
      .doc(userId)
      .get();
    const preferences = userDoc.data()?.notificationPreferences;

    if (!preferences) return true; // Default to send if no preferences

    // Check global push notifications setting
    if (!preferences.pushNotifications) return false;

    // ✅ Map notification types to preference keys
    const typeMapping: { [key: string]: string } = {
      request_vendor_review: "requestVendorReview",
      new_review: "newReview",
      review_update: "reviewUpdate",
      review_deleted: "reviewDeleted",
      vendor_response: "vendorResponse",
      chat_message: "chatMessage",
      // ✅ Add these missing mappings
      chatMessage: "chatMessage",
      requestVendorReview: "requestVendorReview",
    };

    // Get the preference key to check
    const preferenceKey =
      typeMapping[notificationType as string] || notificationType;

    // Check specific notification type
    return preferences[preferenceKey] !== false;
  } catch (error) {
    console.error("Error checking notification preferences:", error);
    return true; // Default to send on error
  }
}

// Notify inviter of registration, but do NOT give credits yet
export const notifyInviterOnRegistration = functions.firestore
  .document("users/{userId}")
  .onCreate(async (snap, context) => {
    const newUser = snap.data();
    const invitedBy = (newUser.invitedBy || "").trim().toUpperCase();
    if (!invitedBy) return null;

    // Find the inviter by referralCode
    const inviterQuery = await admin
      .firestore()
      .collection("users")
      .where("referralCode", "==", invitedBy)
      .limit(1)
      .get();

    if (inviterQuery.empty) {
      console.log(`No inviter found with referralCode: ${invitedBy}`);
      return null;
    }

    const inviterDoc = inviterQuery.docs[0];
    const inviterId = inviterDoc.id;
    const inviterFcmToken = inviterDoc.get("fcmToken");

    // Compose full name for notification
    const fullName = [newUser.name, newUser.lastName].filter(Boolean).join(" ");

    // Create notification document (no message, just data for translation)
    await admin
      .firestore()
      .collection("notifications")
      .add({
        userId: inviterId,
        type: "referral_pending",
        invitedPerson: fullName,
        role: newUser.role || "client",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });

    // Send push notification if inviter has an FCM token
    if (inviterFcmToken) {
      const payload = {
        notification: {
          title: "Referral Update",
          body: "", // Leave empty, app will translate
        },
        token: inviterFcmToken,
        data: {
          type: "referral_pending",
          invitedPerson: fullName,
          role: newUser.role,
        },
      };

      try {
        await admin.messaging().send(payload);
        console.log(`Push notification sent to inviter ${inviterId}`);
      } catch (err) {
        console.error("Error sending push notification:", err);
      }
    }

    console.log(
      `Notified inviter ${inviterId} about registration of user ${context.params.userId}`
    );
    return null;
  });

export const rewardInviterOnFirstOrder = functions.firestore
  .document("orders/{orderId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // Only proceed if status changed to 'delivered'
    if (before.status === after.status || after.status !== "delivered") {
      return null;
    }

    const clientId = after.clientId;
    if (!clientId) return null;

    // Get client user document
    const clientRef = admin.firestore().collection("users").doc(clientId);
    const clientDoc = await clientRef.get();
    const clientData = clientDoc.data();

    // Check if client was invited and hasn't triggered referral reward
    if (!clientData?.invitedBy || clientData?.referralRewarded) {
      return null;
    }

    // Check if this is the client's first delivered order
    const deliveredOrdersSnap = await admin
      .firestore()
      .collection("orders")
      .where("clientId", "==", clientId)
      .where("status", "==", "delivered")
      .get();

    if (deliveredOrdersSnap.size > 1) {
      // Not the first delivered order
      return null;
    }

    // Find the inviter by referralCode
    const inviterQuery = await admin
      .firestore()
      .collection("users")
      .where("referralCode", "==", clientData.invitedBy)
      .limit(1)
      .get();

    if (inviterQuery.empty) {
      console.log(
        `No inviter found with referralCode: ${clientData.invitedBy}`
      );
      return null;
    }

    const inviterDoc = inviterQuery.docs[0];
    const inviterRef = inviterDoc.ref;
    const inviterId = inviterDoc.id;
    const inviterFcmToken = inviterDoc.get("fcmToken");

    // Allocate credits (e.g., 5)
    const creditsToAdd = 5;
    await inviterRef.update({
      credits: admin.firestore.FieldValue.increment(creditsToAdd),
    });

    // Compose full name for notification
    const fullName = [clientData.name, clientData.lastName]
      .filter(Boolean)
      .join(" ");

    // Create notification document (no message, just data for translation)
    await admin.firestore().collection("notifications").add({
      userId: inviterId,
      type: "referral",
      creditsEarned: creditsToAdd,
      invitedPerson: fullName,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      read: false,
    });

    // Mark client as rewarded
    await clientRef.update({ referralRewarded: true });

    // Optionally, send push notification (let app translate)
    if (inviterFcmToken) {
      const payload = {
        notification: {
          title: "Referral Bonus!",
          body: "", // Let app translate
        },
        token: inviterFcmToken,
        data: {
          type: "referral",
          creditsEarned: String(creditsToAdd),
          invitedPerson: fullName,
        },
      };

      try {
        await admin.messaging().send(payload);
        console.log(`Push notification sent to inviter ${inviterId}`);
      } catch (err) {
        console.error("Error sending push notification:", err);
      }
    }

    console.log(
      `Allocated ${creditsToAdd} credits to inviter ${inviterId} for client ${clientId}'s first delivered order`
    );
    return null;
  });

export const incrementReviewsCountOnReviewCreate = functions.firestore
  .document("reviews/{reviewId}")
  .onCreate(async (snap, context) => {
    const review = snap.data();
    const batch = admin.firestore().batch();

    // Only increment vendor's reviewsCount if this is a vendor review (no foodItemId)
    if (review.vendorId && !review.foodItemId) {
      const vendorRef = admin
        .firestore()
        .collection("users")
        .doc(review.vendorId);
      batch.update(vendorRef, {
        reviewsCount: admin.firestore.FieldValue.increment(1),
      });
    }

    // Only increment food item's reviewsCount if this is a food review
    if (review.foodItemId) {
      const foodItemRef = admin
        .firestore()
        .collection("foodItems")
        .doc(review.foodItemId);
      batch.update(foodItemRef, {
        reviewsCount: admin.firestore.FieldValue.increment(1),
      });
    }

    await batch.commit();

    // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
    const shouldSend = await shouldSendNotification(
      review.vendorId,
      "newReview"
    );
    if (!shouldSend) {
      console.log(
        `Skipping new_review notification for vendor ${review.vendorId} - disabled in preferences`
      );
      return null;
    }

    // Fetch the order's publicCode using orderId from the review
    let publicCode = null;
    if (review.orderId) {
      const orderSnap = await admin
        .firestore()
        .collection("orders")
        .doc(review.orderId)
        .get();
      if (orderSnap.exists) {
        publicCode = orderSnap.get("publicCode") || null;
      }
    }

    // Create a notification for the vendor (translatable in app)
    await admin
      .firestore()
      .collection("notifications")
      .add({
        userId: review.vendorId,
        type: "new_review",
        reviewId: context.params.reviewId,
        foodItemId: review.foodItemId || null,
        clientName: review.clientName || null,
        hideClientName: review.hideClientName || false,
        publicCode: publicCode,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });

    return null;
  });

export const notifyVendorOnReviewUpdate = functions.firestore
  .document("reviews/{reviewId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // Only notify if the comment, photos, videos, or hideClientName changed
    if (
      before.comment === after.comment &&
      JSON.stringify(before.photos) === JSON.stringify(after.photos) &&
      JSON.stringify(before.videos) === JSON.stringify(after.videos) &&
      before.hideClientName === after.hideClientName
    ) {
      return null; // No relevant change
    }

    // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
    const shouldSend = await shouldSendNotification(
      after.vendorId,
      "reviewUpdate"
    );
    if (!shouldSend) {
      console.log(
        `Skipping review_update notification for vendor ${after.vendorId} - disabled in preferences`
      );
      return null;
    }

    // Fetch the order's publicCode using orderId from the review
    let publicCode = null;
    if (after.orderId) {
      const orderSnap = await admin
        .firestore()
        .collection("orders")
        .doc(after.orderId)
        .get();
      if (orderSnap.exists) {
        publicCode = orderSnap.get("publicCode") || null;
      }
    }

    await admin
      .firestore()
      .collection("notifications")
      .add({
        userId: after.vendorId,
        type: "review_update",
        reviewId: context.params.reviewId,
        foodItemId: after.foodItemId || null,
        clientName: after.clientName || null,
        hideClientName: after.hideClientName || false,
        publicCode: publicCode,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });

    return null;
  });

export const decrementReviewsCountOnReviewDelete = functions.firestore
  .document("reviews/{reviewId}")
  .onDelete(async (snap, context) => {
    const review = snap.data();
    const batch = admin.firestore().batch();

    // Decrement vendor's reviewsCount and delete vendor rating doc if this is a vendor review (no foodItemId)
    if (review.vendorId && !review.foodItemId) {
      const vendorRef = admin
        .firestore()
        .collection("users")
        .doc(review.vendorId);
      batch.update(vendorRef, {
        reviewsCount: admin.firestore.FieldValue.increment(-1),
      });

      // Also delete the vendor's rating doc for this client
      if (review.clientId) {
        const ratingRef = admin
          .firestore()
          .collection("users")
          .doc(review.vendorId)
          .collection("ratings")
          .doc(review.clientId);
        batch.delete(ratingRef);
      }
    }

    // Decrement food item's reviewsCount and delete food item rating doc if this is a food review
    if (review.foodItemId) {
      const foodItemRef = admin
        .firestore()
        .collection("foodItems")
        .doc(review.foodItemId);
      batch.update(foodItemRef, {
        reviewsCount: admin.firestore.FieldValue.increment(-1),
      });

      // Also delete the food item's rating doc for this client
      if (review.clientId) {
        const foodRatingRef = admin
          .firestore()
          .collection("foodItems")
          .doc(review.foodItemId)
          .collection("ratings")
          .doc(review.clientId);
        batch.delete(foodRatingRef);
      }
    }

    await batch.commit();
    return null;
  });

export const notifyClientOnVendorResponse = functions.firestore
  .document("reviews/{reviewId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // Only notify if the response was added or changed
    if (
      (!before.response && after.response) ||
      before.response?.text !== after.response?.text
    ) {
      // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
      const shouldSend = await shouldSendNotification(
        after.clientId,
        "vendorResponse"
      );
      if (!shouldSend) {
        console.log(
          `Skipping vendor_response notification for client ${after.clientId} - disabled in preferences`
        );
        return null;
      }

      // Fetch vendor name
      let vendorName = "";
      if (after.vendorId) {
        const vendorDoc = await admin
          .firestore()
          .collection("users")
          .doc(after.vendorId)
          .get();
        vendorName = vendorDoc.exists ? vendorDoc.get("name") || "" : "";
      }

      await admin
        .firestore()
        .collection("notifications")
        .add({
          userId: after.clientId,
          type: "vendor_response",
          reviewId: context.params.reviewId,
          vendorId: after.vendorId,
          vendorName: vendorName,
          foodItemId: after.foodItemId || null,
          publicCode: after.publicCode || null,
          hideClientName: after.hideClientName || false,
          clientName: after.clientName || null,
          responseText: after.response?.text || "",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          read: false,
        });
    }
    return null;
  });

export const notifyClientToReviewVendor = functions.firestore
  .document("orders/{orderId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // Only proceed if status changed to 'delivered'
    if (before.status === after.status || after.status !== "delivered") {
      return null;
    }

    // Get clientId and vendorId
    const clientId = after.clientId;
    const vendorId = after.vendorId;
    if (!clientId || !vendorId) return null;

    // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
    const shouldSend = await shouldSendNotification(
      clientId,
      "request_vendor_review"
    );
    if (!shouldSend) {
      console.log(
        `Skipping request_vendor_review notification for client ${clientId} - disabled in preferences`
      );
      return null;
    }

    // Get order public code
    const publicCode = after.publicCode || "";
    const reviewTimestamp = new Date(Date.now() + 1000); // 1 second later

    // Create a notification for the client to review the vendor
    await admin.firestore().collection("notifications").add({
      userId: clientId,
      type: "request_vendor_review",
      vendorId: vendorId,
      orderId: context.params.orderId,
      publicCode: publicCode,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: reviewTimestamp,
      read: false,
    });

    return null;
  });

export const rewardInviterOnVendorSubscription = functions.firestore
  .document("users/{vendorId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // Only proceed if role is vendor and menuSlots changed from falsy to truthy (subscription activated)
    if (
      after.role !== "vendor" ||
      !after.invitedBy ||
      before.menuSlots === after.menuSlots || // No change
      !after.menuSlots || // Not activated
      after.referralRewarded // Already rewarded
    ) {
      return null;
    }

    // Find inviter by referralCode
    const inviterQuery = await admin
      .firestore()
      .collection("users")
      .where("referralCode", "==", after.invitedBy)
      .limit(1)
      .get();

    if (inviterQuery.empty) {
      console.log(`No inviter found with referralCode: ${after.invitedBy}`);
      return null;
    }

    const inviterDoc = inviterQuery.docs[0];
    const inviterRef = inviterDoc.ref;
    const inviterId = inviterDoc.id;
    const inviterFcmToken = inviterDoc.get("fcmToken");

    // Add 15 credits to inviter
    const creditsToAdd = 15;
    await inviterRef.update({
      credits: admin.firestore.FieldValue.increment(creditsToAdd),
    });

    // Mark vendor as rewarded so it doesn't trigger again
    await change.after.ref.update({ referralRewarded: true });

    // Compose full name for notification
    const fullName = [after.name, after.lastName].filter(Boolean).join(" ");

    // Create notification document
    await admin.firestore().collection("notifications").add({
      userId: inviterId,
      type: "referral",
      creditsEarned: creditsToAdd,
      invitedPerson: fullName,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      read: false,
    });

    // Optionally, send push notification
    if (inviterFcmToken) {
      const payload = {
        notification: {
          title: "Referral Bonus!",
          body: "", // Let app translate
        },
        token: inviterFcmToken,
        data: {
          type: "referral",
          creditsEarned: String(creditsToAdd),
          invitedPerson: fullName,
        },
      };

      try {
        await admin.messaging().send(payload);
        console.log(`Push notification sent to inviter ${inviterId}`);
      } catch (err) {
        console.error("Error sending push notification:", err);
      }
    }

    console.log(
      `Allocated ${creditsToAdd} credits to inviter ${inviterId} for vendor ${context.params.vendorId}'s subscription`
    );
    return null;
  });

// Aggregate vendor ratings when a rating is added/updated/deleted
export const aggregateVendorRatings = functions.firestore
  .document("users/{vendorId}/ratings/{clientId}")
  .onWrite(async (change, context) => {
    console.log("Vendor rating aggregation triggered!");

    const vendorId = context.params.vendorId;
    const ratingsRef = admin
      .firestore()
      .collection("users")
      .doc(vendorId)
      .collection("ratings");
    const vendorRef = admin.firestore().collection("users").doc(vendorId);

    const ratingsSnapshot = await ratingsRef.get();
    let total = 0;
    let count = 0;

    ratingsSnapshot.forEach((doc) => {
      const data = doc.data();
      if (typeof data.stars === "number") {
        total += data.stars;
        count += 1;
      }
    });

    const average = count > 0 ? total / count : 0;

    try {
      await vendorRef.update({
        rating: average,
        totalRatings: count,
      });
      console.log(
        `Updated vendor ${vendorId}: rating=${average}, totalRatings=${count}`
      );
    } catch (error) {
      console.error("Error updating vendor rating:", error);
    }

    return null;
  });

export const notifyAdminOnSubscriptionReceipt = functions.firestore
  .document("subscriptionPayments/{receiptId}")
  .onCreate(async (snap, context) => {
    const data = snap.data();
    if (!data || data.status !== "pending") return null;

    // Get your email credentials from Firebase config
    const adminEmail = "samansaeedi102@gmail.com"; // Change to your admin email
    const yahooEmail = functions.config().gmail?.email;
    const yahooPassword = functions.config().gmail?.password;

    if (!yahooEmail || !yahooPassword) {
      console.error("❌ Yahoo credentials not configured");
      throw new Error("Yahoo credentials not configured");
    }

    // Create transporter using Yahoo
    const transporter = nodemailer.createTransport({
      service: "yahoo",
      auth: {
        user: yahooEmail,
        pass: yahooPassword,
      },
    });

    const mailOptions = {
      from: yahooEmail,
      to: adminEmail,
      subject: `💳 New Vendor Subscription Payment - ${data.vendorId}`,
      html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2>New Subscription Payment Receipt Submitted</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td><b>Receipt ID:</b></td><td>${context.params.receiptId}</td></tr>
        <tr><td><b>Vendor ID:</b></td><td>${data.vendorId}</td></tr>
        <tr><td><b>Plan:</b></td><td>${data.plan}</td></tr>
        <tr><td><b>Amount:</b></td><td>${data.amount} €</td></tr>
        <tr><td><b>Payment Method:</b></td><td>${data.paymentMethod}</td></tr>
        <tr><td><b>Created At:</b></td><td>${data.createdAt}</td></tr>
        <tr><td><b>Receipt Image:</b></td><td><a href="${data.proofUrl}">View Image</a></td></tr>
      </table>
      <p>
        <a href="https://console.firebase.google.com/project/YOUR_PROJECT_ID/firestore/data/~2FsubscriptionPayments~2F${context.params.receiptId}">
          🔗 View this receipt in Firestore
        </a>
      </p>
    </div>
  `,
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log("✅ Admin notified about new subscription payment receipt");
    } catch (error) {
      console.error("❌ Failed to send admin email:", error);
    }

    return null;
  });

// Aggregate food item ratings when a rating is added/updated/deleted
export const aggregateFoodItemRatings = functions.firestore
  .document("foodItems/{foodItemId}/ratings/{clientId}")
  .onWrite(async (change, context) => {
    console.log("Food item rating aggregation triggered!");

    const foodItemId = context.params.foodItemId;
    const foodItemRef = admin
      .firestore()
      .collection("foodItems")
      .doc(foodItemId);
    const ratingsSnap = await foodItemRef.collection("ratings").get();

    let totalStars = 0;
    let totalRatings = ratingsSnap.size;

    ratingsSnap.forEach((doc) => {
      const data = doc.data();
      if (typeof data.stars === "number") {
        totalStars += data.stars;
      }
    });

    const avgRating = totalRatings > 0 ? totalStars / totalRatings : 0;

    await foodItemRef.update({
      rating: Math.round(avgRating * 10) / 10, // round to 1 decimal
      totalRatings: totalRatings,
    });

    console.log(
      `Updated food item ${foodItemId}: rating=${avgRating}, totalRatings=${totalRatings}`
    );
  });

// Notify vendor when a new order is created
export const notifyVendorOnNewOrder = functions.firestore
  .document("orders/{orderId}")
  .onCreate(async (snap, context) => {
    const order = snap.data();
    if (!order) return null;

    const vendorId = order.vendorId;
    const clientName = order.clientName || "";
    const publicCode = order.publicCode || ""; // ✅ This gets the publicCode from the order
    const orderId = context.params.orderId;

    if (!vendorId) {
      console.log("No vendor ID found for order");
      return null;
    }

    // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
    const shouldSend = await shouldSendNotification(vendorId, "newOrder");
    if (!shouldSend) {
      console.log(
        `Skipping new order notification for vendor ${vendorId} - disabled in preferences`
      );
      return null;
    }

    try {
      // Create notification for vendor
      await admin.firestore().collection("notifications").add({
        userId: vendorId,
        type: "newOrder",
        orderId: orderId,
        publicCode: publicCode, // ✅ Now publicCode will be available
        clientName: clientName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });

      console.log(
        `New order notification created for vendor ${vendorId}, order ${
          publicCode || orderId
        }`
      );
    } catch (error) {
      console.error("Error creating new order notification:", error);
    }

    return null;
  });

// Notify client when order status changes
export const notifyClientOnOrderStatusChange = functions.firestore
  .document("orders/{orderId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // Only proceed if status actually changed
    if (before.status === after.status) {
      return null;
    }

    const clientId = after.clientId;
    const orderId = context.params.orderId;
    const publicCode = after.publicCode || orderId;
    const clientName = after.clientInfo?.name
      ? `${after.clientInfo.name} ${after.clientInfo.lastName || ""}`.trim()
      : after.clientName || "";

    if (!clientId) {
      console.log("No client ID found for order");
      return null;
    }

    // Determine notification type based on new status
    let notificationType = "";

    switch (after.status) {
      case "accepted":
        notificationType = "orderAccepted";
        break;
      case "rejected":
        notificationType = "orderRejected";
        break;
      case "delivered":
        notificationType = "orderDelivered";
        break;
      default:
        console.log(`No notification needed for status: ${after.status}`);
        return null;
    }

    // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
    const shouldSend = await shouldSendNotification(clientId, notificationType);
    if (!shouldSend) {
      console.log(
        `Skipping ${notificationType} notification for client ${clientId} - disabled in preferences`
      );
      return null;
    }

    try {
      // ✅ CREATE NOTIFICATION DATA WITH ALL FIELDS DEFINED UPFRONT
      let notificationData: any = {
        userId: clientId,
        type: notificationType,
        orderId: orderId,
        publicCode: publicCode,
        clientName: clientName,
        vendorId: after.vendorId,
        rejectionReason: after.rejectionReason || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      };

      // ✅ ADD TYPE-SPECIFIC FIELDS BASED ON STATUS
      if (notificationType === "orderAccepted") {
        const deliveryDate = after.deliveryDate || after.selectedDate;
        notificationData = {
          ...notificationData,
          deliveryDate: deliveryDate || null,
          delivered: false,
        };
      } else if (notificationType === "orderDelivered") {
        notificationData = {
          ...notificationData,
          delivered: true,
        };
      }

      // Create notification for client
      await admin.firestore().collection("notifications").add(notificationData);

      console.log(
        `${notificationType} notification created for client ${clientId}, order ${publicCode}`
      );
    } catch (error) {
      console.error(`Error creating ${notificationType} notification:`, error);
    }

    return null;
  });

// Send push notification when a new notification is created
export const sendPushOnNotificationCreate = functions.firestore
  .document("notifications/{notificationId}")
  .onCreate(async (snap: functions.firestore.DocumentSnapshot) => {
    console.log("Notification push function triggered!");

    const notification = snap.data();
    if (!notification) {
      console.log("No notification data found.");
      return null;
    }

    const userId = notification.userId;
    const message = notification.message;
    const notificationType = notification.type || "general";
    const orderId = notification.orderId;
    const publicCode = notification.publicCode;

    // ✅ CHECK USER PREFERENCES BEFORE SENDING
    const shouldSend = await shouldSendNotification(userId, notificationType);
    if (!shouldSend) {
      console.log(
        `Skipping notification for user ${userId}, type ${notificationType} - disabled in preferences`
      );
      return null;
    }

    // Get user's FCM token
    const userDoc = await admin
      .firestore()
      .collection("users")
      .doc(userId)
      .get();
    const fcmToken = userDoc.get("fcmToken");
    const userRole = userDoc.get("role") || "client"; // Default to client

    console.log("FCM token retrieved:", fcmToken);

    if (!fcmToken) {
      console.log("No FCM token found for user:", userId);
      return null;
    }

    // Determine notification title and body based on type
    let notificationTitle = "New Notification";
    let notificationBody = message;

    switch (notificationType) {
      case "chat_message":
        notificationTitle = "New Message";
        break;
      case "orderAccepted":
        notificationTitle = "Order Accepted";
        notificationBody = `Your order ${
          publicCode || orderId || ""
        } has been accepted`;
        break;
      case "orderRejected":
        notificationTitle = "Order Rejected";
        notificationBody = `Your order ${
          publicCode || orderId || ""
        } has been rejected`;
        break;
      case "newOrder":
        notificationTitle = "New Order";
        notificationBody = `You have a new order ${
          publicCode || orderId || ""
        }`;
        break;
      case "orderDelivered":
        notificationTitle = "Order Delivered";
        notificationBody = `Your order ${
          publicCode || orderId || ""
        } has been delivered`;
        break;
      case "referral":
        notificationTitle = "Referral Bonus!";
        break;
      case "referral_pending":
        notificationTitle = "Referral Update";
        if (notification.role === "vendor") {
          notificationBody = `${notification.invitedPerson} registered with your invitation! You will receive 15 credits when they complete their first subscription`;
        } else {
          notificationBody = `${notification.invitedPerson} registered with your invitation! You will receive 5 credits when they place and complete their first order`;
        }
        break;
      case "new_review":
        notificationTitle = "New Review";
        notificationBody = "";
        break;
      case "review_update":
        notificationTitle = "Review Updated";
        notificationBody = "";
        break;
      case "review_deleted":
        notificationTitle = "Review Deleted";
        notificationBody = "";
        break;
      case "vendor_response":
        notificationTitle = "Vendor Responded";
        notificationBody = "The vendor has responded to your review.";
        break;
      case "request_vendor_review":
        notificationTitle = "Review Your Vendor";
        notificationBody = `Please leave a review for order ${
          publicCode || orderId || ""
        }`;
        break;
      default:
        notificationTitle = "Food Delivery Update";
        break;
    }

    // Create message payload with proper TypeScript types
    const messagePayload: admin.messaging.Message = {
      notification: {
        title: notificationTitle,
        body: notificationBody,
      },
      data: {
        title: notificationTitle,
        body: notificationBody,
        type: notificationType,
        userRole: userRole,
        orderId: orderId || "",
        publicCode: publicCode || "",
        userId: userId,
      },
      android: {
        notification: {
          title: notificationTitle,
          body: notificationBody,
          icon: "ic_notification",
          color: "#FF6B35",
          sound: "default",
        },
        priority: "high" as const, // Fix: Explicit type
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: notificationTitle,
              body: notificationBody,
            },
            sound: "default",
            badge: 1,
          },
        },
      },
      token: fcmToken,
    };

    try {
      await admin.messaging().send(messagePayload);
      console.log("Push notification sent successfully to user:", userId);
    } catch (error) {
      console.error("Error sending push notification:", error);
    }

    return null;
  });

// Send chat push notifications directly without saving to Firestore
export const sendChatPushNotification = functions.https.onCall(
  async (data, context) => {
    console.log("Chat push notification function triggered!");

    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "User must be authenticated"
      );
    }

    const { recipientId, senderName, message, conversationId } = data;

    if (!recipientId || !senderName || !message) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "recipientId, senderName, and message are required"
      );
    }

    // ✅ CHECK USER PREFERENCES FOR CHAT MESSAGES
    const shouldSend = await shouldSendNotification(recipientId, "chatMessage");
    if (!shouldSend) {
      console.log(
        `Skipping chat notification for user ${recipientId} - disabled in preferences`
      );
      return { success: false, reason: "Chat notifications disabled by user" };
    }

    try {
      // Get recipient FCM token and role
      const userDoc = await admin
        .firestore()
        .collection("users")
        .doc(recipientId)
        .get();
      const fcmToken = userDoc.get("fcmToken");
      const userRole = userDoc.get("role") || "client";

      console.log("FCM token retrieved:", fcmToken);

      if (!fcmToken) {
        console.log("No FCM token found for user:", recipientId);
        return { success: false, reason: "No FCM token found" };
      }

      // Create the notification message
      const notificationTitle = "New Message";
      const notificationBody = `${senderName}: ${
        message.length > 50 ? message.substring(0, 50) + "..." : message
      }`;

      const messagePayload: admin.messaging.Message = {
        notification: {
          title: notificationTitle,
          body: notificationBody,
        },
        data: {
          title: notificationTitle,
          body: notificationBody,
          type: "chat_message",
          senderId: context.auth.uid,
          senderName,
          conversationId: conversationId || "",
          originalMessage: message,
          userRole: userRole,
        },
        android: {
          notification: {
            title: notificationTitle,
            body: notificationBody,
            icon: "ic_notification",
            color: "#FF6B35",
            sound: "default",
          },
          priority: "high" as const, // Fix: Explicit type
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: notificationTitle,
                body: notificationBody,
              },
              sound: "default",
              badge: 1,
            },
          },
        },
        token: fcmToken,
      };

      await admin.messaging().send(messagePayload);
      console.log(
        "Chat push notification sent successfully to user:",
        recipientId
      );
      return { success: true };
    } catch (error) {
      console.error("Error sending chat push notification:", error);
      throw new functions.https.HttpsError(
        "internal",
        "Failed to send chat notification"
      );
    }
  }
);

// Update order statistics when an order status changes
// Cloud Function: updateOrderStatistics
export const updateOrderStatistics = functions.firestore
  .document("orders/{orderId}")
  .onWrite(async (change, context) => {
    console.log("Order statistics update triggered!");

    const beforeData = change.before.exists ? change.before.data() : null;
    const afterData = change.after.exists ? change.after.data() : null;

    // Only process if status changed
    const beforeStatus = beforeData?.status;
    const afterStatus = afterData?.status;

    if (beforeStatus === afterStatus) {
      return null;
    }

    // Use vendorId from afterData if exists, else from beforeData (for deletions)
    const vendorId = afterData ? afterData.vendorId : beforeData?.vendorId;
    if (!vendorId) {
      console.log("No vendor ID found for order");
      return null;
    }

    try {
      const vendorRef = admin.firestore().collection("users").doc(vendorId);
      const vendorDoc = await vendorRef.get();
      const vendorData = vendorDoc.data();

      if (!vendorData) {
        console.log("Vendor not found");
        return null;
      }

      // Initialize statistics if they don't exist
      const stats = vendorData.orderStatistics || {
        totalOrders: 0,
        completedOrders: 0,
        pendingOrders: 0,
        rejectedOrders: 0,
      };

      // Handle order deletion
      if (!afterData) {
        if (beforeStatus === "pending") {
          stats.pendingOrders = Math.max(0, (stats.pendingOrders || 0) - 1);
        }
        if (beforeStatus === "delivered") {
          stats.completedOrders = Math.max(0, (stats.completedOrders || 0) - 1);
        }
        if (beforeStatus === "rejected") {
          stats.rejectedOrders = Math.max(0, (stats.rejectedOrders || 0) - 1);
        }
        stats.totalOrders = Math.max(0, (stats.totalOrders || 0) - 1);

        await vendorRef.update({
          orderStatistics: stats,
          lastOrderUpdate: admin.firestore.FieldValue.serverTimestamp(),
        });
        return null;
      }

      // Status transitions
      if (afterStatus === "delivered" && beforeStatus !== "delivered") {
        stats.completedOrders = (stats.completedOrders || 0) + 1;
      }
      if (afterStatus === "rejected" && beforeStatus !== "rejected") {
        stats.rejectedOrders = (stats.rejectedOrders || 0) + 1;
      }
      // Only increment pendingOrders on status change to "pending" if not a new order
      if (
        beforeStatus !== afterStatus &&
        afterStatus === "pending" &&
        beforeData
      ) {
        stats.pendingOrders = (stats.pendingOrders || 0) + 1;
      }
      if (afterStatus === "accepted" && beforeStatus !== "accepted") {
        // Transitional state, do nothing
      }
      if (beforeStatus === "delivered" && afterStatus !== "delivered") {
        stats.completedOrders = Math.max(0, (stats.completedOrders || 0) - 1);
      }
      if (beforeStatus === "rejected" && afterStatus !== "rejected") {
        stats.rejectedOrders = Math.max(0, (stats.rejectedOrders || 0) - 1);
      }
      if (beforeStatus === "pending" && afterStatus !== "pending") {
        stats.pendingOrders = Math.max(0, (stats.pendingOrders || 0) - 1);
      }
      if (!beforeData) {
        stats.totalOrders = (stats.totalOrders || 0) + 1;
        if (afterStatus === "pending") {
          stats.pendingOrders = (stats.pendingOrders || 0) + 1;
        }
        if (afterStatus === "delivered") {
          stats.completedOrders = (stats.completedOrders || 0) + 1;
        }
      }

      await vendorRef.update({
        orderStatistics: stats,
        lastOrderUpdate: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Updated vendor ${vendorId} statistics:`, stats);
    } catch (error) {
      console.error("Error updating order statistics:", error);
    }

    return null;
  });

export const notifyVendorsOfUpcomingOrders = functions.pubsub
  .schedule("every day 07:00") // Run every day at 7 AM UTC
  .timeZone("UTC")
  .onRun(async (_context) => {
    const db = admin.firestore();
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const twoDaysLater = new Date(now);
    twoDaysLater.setDate(now.getDate() + 2);

    // Query orders with deliveryDate in [now, twoDaysLater], status pending or accepted
    const ordersSnap = await db
      .collection("orders")
      .where("deliveryDate", ">=", now.toISOString())
      .where("deliveryDate", "<=", twoDaysLater.toISOString())
      .where("status", "in", ["pending", "accepted"])
      .get();

    if (ordersSnap.empty) {
      console.log("No upcoming orders found.");
      return null;
    }

    const notifications: any[] = [];

    for (const doc of ordersSnap.docs) {
      const order = doc.data();
      const vendorId = order.vendorId;
      if (!vendorId) continue;

      // Check if a notification for this order & vendor already exists (avoid duplicates)
      const existing = await db
        .collection("notifications")
        .where("userId", "==", vendorId)
        .where("type", "==", "upcomingOrder")
        .where("orderId", "==", doc.id)
        .get();
      if (!existing.empty) continue;

      notifications.push({
        userId: vendorId,
        type: "upcomingOrder",
        orderId: doc.id,
        publicCode: order.publicCode || "",
        deliveryDate: order.deliveryDate,
        clientName: order.clientName || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });
    }

    // Batch create notifications
    const batch = db.batch();
    notifications.forEach((notif) => {
      const ref = db.collection("notifications").doc();
      batch.set(ref, notif);
    });
    if (notifications.length > 0) {
      await batch.commit();
      console.log(
        `Created ${notifications.length} upcoming order notifications.`
      );
    }

    return null;
  });

// Clean up old notifications (runs daily)
export const cleanupOldNotifications = functions.pubsub
  .schedule("0 2 * * *") // Run at 2 AM daily
  .timeZone("UTC")
  .onRun(async (_context: functions.EventContext) => {
    console.log("Cleaning up old notifications...");

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    try {
      const oldNotificationsQuery = admin
        .firestore()
        .collection("notifications")
        .where("timestamp", "<", thirtyDaysAgo)
        .limit(500); // Process in batches

      const snapshot = await oldNotificationsQuery.get();

      if (snapshot.empty) {
        console.log("No old notifications to clean up");
        return;
      }

      const batch = admin.firestore().batch();
      let count = 0;

      snapshot.forEach((doc) => {
        batch.delete(doc.ref);
        count++;
      });

      await batch.commit();
      console.log(`Deleted ${count} old notifications`);
    } catch (error) {
      console.error("Error cleaning up old notifications:", error);
    }
  });

// Send email notification to admin when restaurant submits documents
export const notifyAdminRestaurantSubmission = functions.firestore
  .document("users/{userId}")
  .onUpdate(async (change, context) => {
    console.log("Restaurant submission notification triggered!");

    const before = change.before.data();
    const after = change.after.data();
    const userId = context.params.userId;

    // Check if this is a restaurant that just submitted documents
    if (
      after.role === "vendor" &&
      after.type === "restaurant" &&
      before.certification?.status !== "under_review" &&
      after.certification?.status === "under_review" &&
      after.certification?.documentsSubmittedAt
    ) {
      console.log(`Restaurant ${userId} submitted documents for review`);

      const restaurantData = {
        id: userId,
        name: `${after.name} ${after.lastName}`,
        email: after.email,
        phone: after.phone,
        location: after.location,
        description: after.description,
        submittedAt: after.certification.documentsSubmittedAt,
        businessLicenseUrl: after.certification.businessLicenseUrl,
        sanitaryCertificationUrl: after.certification.sanitaryCertificationUrl,
        workPermitUrl: after.certification.workPermitUrl,
      };

      try {
        // Send email notification
        await sendAdminEmailWithYahoo(restaurantData);

        // Also log to admin notifications collection for dashboard
        await admin
          .firestore()
          .collection("adminNotifications")
          .add({
            type: "restaurant_submission",
            restaurantId: userId,
            restaurantName: restaurantData.name,
            restaurantEmail: restaurantData.email,
            submittedAt: restaurantData.submittedAt,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            read: false,
            priority: "high",
            message: `New restaurant "${restaurantData.name}" has submitted documents for approval`,
          });

        console.log(
          `✅ Admin notified about restaurant: ${restaurantData.name}`
        );
      } catch (error) {
        console.error("❌ Failed to notify admin:", error);
      }
    }

    return null;
  });

// Helper function to send email using Yahoo Mail
async function sendAdminEmailWithYahoo(restaurant: any) {
  const nodemailer = require("nodemailer");

  // Get Yahoo credentials from Firebase config
  const yahooEmail = functions.config().gmail?.email;
  const yahooPassword = functions.config().gmail?.password;

  if (!yahooEmail || !yahooPassword) {
    console.error("❌ Yahoo credentials not configured");
    throw new Error("Yahoo credentials not configured");
  }

  // Create transporter using Yahoo
  const transporter = nodemailer.createTransport({
    service: "yahoo",
    auth: {
      user: yahooEmail,
      pass: yahooPassword,
    },
  });

  const adminEmail = "samansaeedi102@gmail.com"; // Send to your Yahoo email

  const mailOptions = {
    from: yahooEmail,
    to: adminEmail,
    subject: `🏪 New Restaurant Pending Approval - ${restaurant.name}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #25567a 0%, #1e4a6b 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">🏪 Keetchen Admin Alert</h1>
          <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">New Restaurant Submission</p>
        </div>
        
        <div style="background: white; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 12px 12px; padding: 30px;">
          <div style="background-color: #f8f9fa; padding: 25px; border-radius: 8px; margin-bottom: 25px;">
            <h2 style="color: #25567a; margin: 0 0 20px 0; font-size: 20px;">📋 Restaurant Details</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 8px 0; font-weight: bold; color: #495057;">Name:</td>
                <td style="padding: 8px 0; color: #212529;">${
                  restaurant.name
                }</td>
              </tr>
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 8px 0; font-weight: bold; color: #495057;">Email:</td>
                <td style="padding: 8px 0; color: #212529;">${
                  restaurant.email
                }</td>
              </tr>
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 8px 0; font-weight: bold; color: #495057;">Phone:</td>
                <td style="padding: 8px 0; color: #212529;">${
                  restaurant.phone
                }</td>
              </tr>
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 8px 0; font-weight: bold; color: #495057;">Location:</td>
                <td style="padding: 8px 0; color: #212529;">${
                  restaurant.location?.city
                }, ${restaurant.location?.country}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 8px 0; font-weight: bold; color: #495057;">Description:</td>
                <td style="padding: 8px 0; color: #212529;">${
                  restaurant.description
                }</td>
              </tr>
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 8px 0; font-weight: bold; color: #495057;">Submitted:</td>
                <td style="padding: 8px 0; color: #212529;">${new Date(
                  restaurant.submittedAt
                ).toLocaleString()}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #495057;">Restaurant ID:</td>
                <td style="padding: 8px 0; color: #212529; font-family: monospace; background: #f1f3f4; padding: 4px 8px; border-radius: 4px;">${
                  restaurant.id
                }</td>
              </tr>
            </table>
          </div>

          <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 25px; margin-bottom: 25px;">
            <h3 style="color: #856404; margin: 0 0 15px 0; font-size: 18px;">📄 Documents to Review</h3>
            <div style="display: flex; flex-direction: column; gap: 12px;">
              <a href="${restaurant.businessLicenseUrl}" target="_blank" 
                 style="display: inline-block; background: #25567a; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; text-align: center;">
                📄 View Business License
              </a>
              <a href="${restaurant.sanitaryCertificationUrl}" target="_blank" 
                 style="display: inline-block; background: #28a745; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; text-align: center;">
                🏥 View Sanitary Certification
              </a>
              <a href="${restaurant.workPermitUrl}" target="_blank" 
                 style="display: inline-block; background: #17a2b8; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; text-align: center;">
                🛂 View Work Permit
              </a>
            </div>
          </div>

          <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; border-radius: 8px; padding: 25px; margin-bottom: 25px;">
            <h3 style="color: #0c5460; margin: 0 0 15px 0; font-size: 18px;">⚡ Next Steps</h3>
            <ol style="color: #0c5460; margin: 0; padding-left: 20px;">
              <li style="margin-bottom: 8px;">Review all uploaded documents by clicking the buttons above</li>
              <li style="margin-bottom: 8px;">Run your admin verification script: <code style="background: #f8f9fa; padding: 2px 6px; border-radius: 3px;">node verify-restaurants.js</code></li>
              <li style="margin-bottom: 8px;">Approve or reject the restaurant application</li>
            </ol>
          </div>

          <div style="background-color: #f8f9fa; border-radius: 8px; padding: 20px; text-align: center;">
            <p style="margin: 0; color: #6c757d; font-size: 14px;">
              📧 This is an automated notification from Keetchen Admin System
            </p>
            <p style="margin: 8px 0 0 0; color: #adb5bd; font-size: 12px;">
              Restaurant Status: Under Review | Priority: High | ${new Date().toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("✅ Yahoo email sent successfully to:", adminEmail);
  } catch (error) {
    console.error("❌ Yahoo email error:", error);
    throw error;
  }
}

// Add this to your existing index.ts file:

// Send email notification to vendor when admin approves/rejects restaurant
export const notifyVendorCertificationUpdate = functions.firestore
  .document("users/{userId}")
  .onUpdate(async (change, context) => {
    console.log("Vendor certification update notification triggered!");

    const before = change.before.data();
    const after = change.after.data();
    const userId = context.params.userId;

    // Check if this is a restaurant certification status change
    if (
      after.role === "vendor" &&
      after.type === "restaurant" &&
      before.certification?.status !== after.certification?.status &&
      (after.certification?.status === "certified" ||
        after.certification?.status === "rejected")
    ) {
      console.log(
        `Restaurant ${userId} certification status changed to: ${after.certification.status}`
      );

      const restaurantData = {
        id: userId,
        name: `${after.name} ${after.lastName}`,
        email: after.email,
        status: after.certification.status,
        rejectionReason: after.certification.rejectionReason,
      };

      try {
        await sendVendorCertificationEmail(restaurantData);
        console.log(
          `✅ Vendor notified about certification: ${restaurantData.status}`
        );
      } catch (error) {
        console.error("❌ Failed to notify vendor:", error);
      }
    }

    return null;
  });

// Helper function to send certification email to vendor
async function sendVendorCertificationEmail(restaurant: any) {
  const nodemailer = require("nodemailer");

  const yahooEmail = functions.config().gmail?.email;
  const yahooPassword = functions.config().gmail?.password;

  if (!yahooEmail || !yahooPassword) {
    throw new Error("Yahoo credentials not configured");
  }

  const transporter = nodemailer.createTransport({
    service: "yahoo",
    auth: {
      user: yahooEmail,
      pass: yahooPassword,
    },
  });

  const isApproved = restaurant.status === "certified";
  const subject = isApproved
    ? `🎉 Welcome to Keetchen - ${restaurant.name}`
    : `📄 Document Update Required - ${restaurant.name}`;

  const mailOptions = {
    from: yahooEmail,
    to: restaurant.email,
    subject: subject,
    html: generateVendorEmailTemplate(restaurant, isApproved),
  };

  await transporter.sendMail(mailOptions);
  console.log(`✅ Vendor email sent successfully to: ${restaurant.email}`);
}

// Email template generator for vendor notifications
function generateVendorEmailTemplate(restaurant: any, isApproved: boolean) {
  if (isApproved) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
        
        <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">🎉 Congratulations!</h1>
          <p style="margin: 10px 0 0 0; font-size: 16px;">Your restaurant is approved</p>
        </div>
        
        <div style="padding: 30px;">
          <h2 style="color: #28a745; margin: 0 0 20px 0; font-size: 20px; text-align: center;">Welcome to Keetchen!</h2>
          
          <div style="background: #d4edda; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <h3 style="color: #155724; margin: 0 0 10px 0; font-size: 16px;">✅ You're all set!</h3>
            <p style="color: #155724; margin: 0; font-size: 14px; line-height: 1.4;">
              Your restaurant "${restaurant.name}" is now live and ready to receive orders.
            </p>
          </div>

          <div style="background: #fff3cd; border-radius: 8px; padding: 20px; text-align: center;">
            <p style="color: #856404; margin: 0; font-size: 14px; font-weight: bold;">
              📱 Restart your Keetchen app to see the updates
            </p>
          </div>
        </div>
      </div>
    `;
  } else {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
        
        <div style="background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); color: white; padding: 30px; text-align: center;">
          <h1 style="margin: 0; font-size: 20px;">📄 Update Required</h1>
          <p style="margin: 10px 0 0 0; font-size: 16px;">Document review completed</p>
        </div>
        
        <div style="padding: 30px;">
          <h2 style="color: #dc3545; margin: 0 0 20px 0; font-size: 18px; text-align: center;">Please resubmit documents</h2>
          
          <div style="background: #f8d7da; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <h3 style="color: #721c24; margin: 0 0 10px 0; font-size: 16px;">📝 Admin feedback:</h3>
            <p style="color: #721c24; margin: 0; font-size: 14px; line-height: 1.4;">
              "${
                restaurant.rejectionReason ||
                "Please review and resubmit your documents."
              }"
            </p>
          </div>

          <div style="background: #d1ecf1; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <h3 style="color: #0c5460; margin: 0 0 10px 0; font-size: 16px;">🔄 What to do:</h3>
            <p style="color: #0c5460; margin: 0; font-size: 14px; line-height: 1.4;">
              1. Fix the mentioned issues<br>
              2. Open your Keetchen app<br>
              3. Tap "Resubmit Documents"
            </p>
          </div>

          <div style="background: #fff3cd; border-radius: 8px; padding: 20px; text-align: center;">
            <p style="color: #856404; margin: 0; font-size: 14px; font-weight: bold;">
              📱 Restart your Keetchen app to see the updates
            </p>
          </div>
        </div>
      </div>
    `;
  }
}
