//version 1
// import * as functions from 'firebase-functions/v1';
// import * as admin from 'firebase-admin';
// import {defineSecret} from 'firebase-functions/params';
// const nodemailer = require('nodemailer');

// const GMAIL_EMAIL = defineSecret('GMAIL_EMAIL');
// const GMAIL_PASSWORD = defineSecret('GMAIL_PASSWORD');

// admin.initializeApp();

// async function shouldSendNotification(
//   userId: string,
//   notificationType: string | number,
// ) {
//   try {
//     // ✅ MANDATORY NOTIFICATIONS - Always send these
//     const mandatoryNotifications = [
//       'orderAccepted',
//       'orderRejected',
//       'orderDelivered',
//       'orderExpired',
//       'newOrder',
//       'referral',
//       'referral_pending',
//       // Booking mandatory notifications
//       'newBooking',
//       'bookingAccepted',
//       'bookingRejected',
//       'bookingCancelled',
//       'bookingExpired',
//       'bookingConflictCancellation',
//     ];

//     // Always send mandatory notifications
//     if (mandatoryNotifications.includes(notificationType as string)) {
//       console.log(`Sending mandatory notification: ${notificationType}`);
//       return true;
//     }

//     // For optional notifications, check user preferences
//     const userDoc = await admin
//       .firestore()
//       .collection('users')
//       .doc(userId)
//       .get();
//     const preferences = userDoc.data()?.notificationPreferences;

//     if (!preferences) return true; // Default to send if no preferences

//     // Check global push notifications setting
//     if (!preferences.pushNotifications) return false;

//     // ✅ Map notification types to preference keys
//     const typeMapping: {[key: string]: string} = {
//       request_vendor_review: 'requestVendorReview',
//       new_review: 'newReview',
//       review_update: 'reviewUpdate',
//       review_deleted: 'reviewDeleted',
//       vendor_response: 'vendorResponse',
//       chat_message: 'chatMessage',
//       // ✅ Add these missing mappings
//       chatMessage: 'chatMessage',
//       requestVendorReview: 'requestVendorReview',
//       // ✅ Booking notification mappings
//       bookingCompleted: 'bookingCompleted',
//       bookingReminder: 'bookingReminder',
//       vendorBookingReminder: 'vendorBookingReminder',
//       request_booking_review: 'requestBookingReview',
//     };

//     // Get the preference key to check
//     const preferenceKey =
//       typeMapping[notificationType as string] || notificationType;

//     // Check specific notification type
//     return preferences[preferenceKey] !== false;
//   } catch (error) {
//     console.error('Error checking notification preferences:', error);
//     return true; // Default to send on error
//   }
// }

// // Centralized push sender that computes unread badge and cleans invalid tokens
// async function sendPushWithBadge(
//   userId: string,
//   basePayload: Partial<admin.messaging.Message>,
// ) {
//   try {
//     const userRef = admin.firestore().collection('users').doc(userId);
//     const userDoc = await userRef.get();
//     if (!userDoc.exists) return null;

//     // Support both fcmToken (string) and fcmTokens (array)
//     const rawTokens = userDoc.get('fcmTokens') || userDoc.get('fcmToken') || [];
//     let tokens: string[] = [];
//     if (Array.isArray(rawTokens)) tokens = rawTokens.filter(Boolean);
//     else if (typeof rawTokens === 'string' && rawTokens) tokens = [rawTokens];
//     if (!tokens.length) return null;

//     // Log tokens and environment to help debug routing/proxy issues
//     // tokens and environment information intentionally not logged in production

//     // Compute unread count excluding chat messages (match client-side behavior)
//     const unreadSnap = await admin
//       .firestore()
//       .collection('notifications')
//       .where('userId', '==', userId)
//       .where('read', '==', false)
//       .get();
//     const unreadCount = unreadSnap.docs.filter(
//       d => d.data()?.type !== 'chat_message',
//     ).length;

//     // Debug: log the computed unread count so we can verify the APNs badge value
//     // computed unreadCount is used to set the APNs badge

//     // Build apns payload with computed badge (preserve other aps fields if provided)
//     const apnsFromBase =
//       basePayload.apns && (basePayload.apns as any).payload
//         ? JSON.parse(JSON.stringify((basePayload.apns as any).payload))
//         : {aps: {}};
//     apnsFromBase.aps = apnsFromBase.aps || {};
//     apnsFromBase.aps.badge = unreadCount;
//     // Debug: log final APNs payload so we can confirm the exact `aps` sent
//     // final APNs payload prepared (not logged in production)
//     // Ensure sound/alert stay if provided in basePayload
//     const apns = {payload: apnsFromBase} as any;

//     // Compose multicast message
//     const multicast: admin.messaging.MulticastMessage = {
//       tokens,
//       notification: basePayload.notification,
//       data: basePayload.data,
//       android: basePayload.android,
//       apns,
//     };

//     let response: any = null;
//     try {
//       response = await admin.messaging().sendMulticast(multicast);
//     } catch (sendErr: any) {
//       // Multicast failed; fall back to sending to each token individually
//       const perResults: Array<{success: boolean; error?: any; token: string}> =
//         [];
//       for (const t of tokens) {
//         try {
//           const singleMsg: admin.messaging.Message = {
//             notification: basePayload.notification,
//             data: basePayload.data,
//             android: basePayload.android,
//             apns,
//             token: t,
//           } as any;
//           const sentId = await admin.messaging().send(singleMsg);
//           perResults.push({success: true, token: t, messageId: sentId} as any);
//         } catch (e) {
//           perResults.push({success: false, error: e, token: t});
//         }
//       }

//       response = {
//         responses: perResults.map(r => ({success: r.success, error: r.error})),
//         successCount: perResults.filter(r => r.success).length,
//         failureCount: perResults.filter(r => !r.success).length,
//       };
//     }

//     // Cleanup invalid tokens (do not log details in production)
//     const invalidTokens: string[] = [];
//     if (response && Array.isArray(response.responses)) {
//       response.responses.forEach((resp: any, idx: number) => {
//         if (!resp.success) {
//           const err = resp.error;
//           const code = (
//             (err && ((err as any).code || (err as any).message)) ||
//             ''
//           )
//             .toString()
//             .toLowerCase();
//           const patterns = [
//             'registration-token-not-registered',
//             'invalid-registration-token',
//             'not-registered',
//             'messaging/registration-token-not-registered',
//             'messaging/invalid-registration-token',
//           ];
//           if (patterns.some((p: string) => code.includes(p)))
//             invalidTokens.push(tokens[idx]);
//         }
//       });
//     }

//     if (invalidTokens.length) {
//       try {
//         if (Array.isArray(rawTokens)) {
//           const newTokens = tokens.filter(t => !invalidTokens.includes(t));
//           await userRef.update({fcmTokens: newTokens});
//         } else {
//           const single = rawTokens as string;
//           if (invalidTokens.includes(single)) {
//             await userRef.update({fcmToken: ''});
//           }
//         }
//       } catch (e) {
//         // failed to cleanup invalid tokens (not logged)
//       }
//     }

//     return response;
//   } catch (error) {
//     return null;
//   }
// }

// // Notify inviter of registration, but do NOT give credits yet
// export const notifyInviterOnRegistration = functions.firestore
//   .document('users/{userId}')
//   .onCreate(async (snap, context) => {
//     const newUser = snap.data();
//     const invitedBy = (newUser.invitedBy || '').trim().toUpperCase();
//     if (!invitedBy) return null;

//     // Find the inviter by referralCode
//     const inviterQuery = await admin
//       .firestore()
//       .collection('users')
//       .where('referralCode', '==', invitedBy)
//       .limit(1)
//       .get();

//     if (inviterQuery.empty) {
//       console.log(`No inviter found with referralCode: ${invitedBy}`);
//       return null;
//     }

//     const inviterDoc = inviterQuery.docs[0];
//     const inviterId = inviterDoc.id;

//     // Compose full name for notification
//     const fullName = [newUser.name, newUser.lastName].filter(Boolean).join(' ');

//     // Create notification document (no message, just data for translation)
//     await admin
//       .firestore()
//       .collection('notifications')
//       .add({
//         userId: inviterId,
//         type: 'referral_pending',
//         invitedPerson: fullName,
//         role: newUser.role || 'client',
//         createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       });

//     // Send push notification if inviter has an FCM token
//     // Send push notification via centralized helper (if any token exists)
//     try {
//       await sendPushWithBadge(inviterId, {
//         notification: {title: 'Referral Update', body: ''},
//         data: {
//           type: 'referral_pending',
//           invitedPerson: fullName,
//           role: newUser.role,
//         },
//       });
//       console.log(`Attempted push notification to inviter ${inviterId}`);
//     } catch (err) {
//       console.error('Error sending push via helper:', err);
//     }

//     console.log(
//       `Notified inviter ${inviterId} about registration of user ${context.params.userId}`,
//     );
//     return null;
//   });

// export const rewardInviterOnFirstOrder = functions.firestore
//   .document('orders/{orderId}')
//   .onUpdate(async (change, context) => {
//     const before = change.before.data();
//     const after = change.after.data();

//     // Only proceed if status changed to 'delivered'
//     if (before.status === after.status || after.status !== 'delivered') {
//       return null;
//     }

//     const clientId = after.clientId;
//     if (!clientId) return null;

//     // Get client user document
//     const clientRef = admin.firestore().collection('users').doc(clientId);
//     const clientDoc = await clientRef.get();
//     const clientData = clientDoc.data();

//     // Check if client was invited and hasn't triggered referral reward
//     if (!clientData?.invitedBy || clientData?.referralRewarded) {
//       return null;
//     }

//     // Check if this is the client's first delivered order
//     const deliveredOrdersSnap = await admin
//       .firestore()
//       .collection('orders')
//       .where('clientId', '==', clientId)
//       .where('status', '==', 'delivered')
//       .get();

//     if (deliveredOrdersSnap.size > 1) {
//       // Not the first delivered order
//       return null;
//     }

//     // Find the inviter by referralCode
//     const inviterQuery = await admin
//       .firestore()
//       .collection('users')
//       .where('referralCode', '==', clientData.invitedBy)
//       .limit(1)
//       .get();

//     if (inviterQuery.empty) {
//       console.log(
//         `No inviter found with referralCode: ${clientData.invitedBy}`,
//       );
//       return null;
//     }

//     const inviterDoc = inviterQuery.docs[0];
//     const inviterRef = inviterDoc.ref;
//     const inviterId = inviterDoc.id;

//     // Allocate credits (e.g., 5)
//     const creditsToAdd = 5;
//     await inviterRef.update({
//       credits: admin.firestore.FieldValue.increment(creditsToAdd),
//     });

//     // Compose full name for notification
//     const fullName = [clientData.name, clientData.lastName]
//       .filter(Boolean)
//       .join(' ');

//     // Create notification document (no message, just data for translation)
//     await admin.firestore().collection('notifications').add({
//       userId: inviterId,
//       type: 'referral',
//       creditsEarned: creditsToAdd,
//       invitedPerson: fullName,
//       createdAt: admin.firestore.FieldValue.serverTimestamp(),
//       timestamp: admin.firestore.FieldValue.serverTimestamp(),
//       read: false,
//     });

//     // Mark client as rewarded
//     await clientRef.update({referralRewarded: true});

//     // Optionally, send push notification (let app translate)
//     try {
//       await sendPushWithBadge(inviterId, {
//         notification: {title: 'Referral Bonus!', body: ''},
//         data: {
//           type: 'referral',
//           creditsEarned: String(creditsToAdd),
//           invitedPerson: fullName,
//         },
//       });
//       console.log(`Attempted push notification to inviter ${inviterId}`);
//     } catch (err) {
//       console.error('Error sending push via helper:', err);
//     }

//     console.log(
//       `Allocated ${creditsToAdd} credits to inviter ${inviterId} for client ${clientId}'s first delivered order`,
//     );
//     return null;
//   });

// export const incrementReviewsCountOnReviewCreate = functions.firestore
//   .document('reviews/{reviewId}')
//   .onCreate(async (snap, context) => {
//     const review = snap.data();
//     const batch = admin.firestore().batch();

//     // Only increment vendor's reviewsCount if this is a vendor review (no foodItemId)
//     if (review.vendorId && !review.foodItemId) {
//       const vendorRef = admin
//         .firestore()
//         .collection('users')
//         .doc(review.vendorId);
//       batch.update(vendorRef, {
//         reviewsCount: admin.firestore.FieldValue.increment(1),
//       });
//     }

//     // Only increment food item's reviewsCount if this is a food review
//     if (review.foodItemId) {
//       const foodItemRef = admin
//         .firestore()
//         .collection('foodItems')
//         .doc(review.foodItemId);
//       batch.update(foodItemRef, {
//         reviewsCount: admin.firestore.FieldValue.increment(1),
//       });
//     }

//     await batch.commit();

//     // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
//     const shouldSend = await shouldSendNotification(
//       review.vendorId,
//       'newReview',
//     );
//     if (!shouldSend) {
//       console.log(
//         `Skipping new_review notification for vendor ${review.vendorId} - disabled in preferences`,
//       );
//       return null;
//     }

//     // Fetch the order's or booking's publicCode using orderId or bookingId from the review
//     let publicCode = null;
//     if (review.orderId) {
//       const orderSnap = await admin
//         .firestore()
//         .collection('orders')
//         .doc(review.orderId)
//         .get();
//       if (orderSnap.exists) {
//         publicCode = orderSnap.get('publicCode') || null;
//       }
//     }
//     // If there's no order publicCode, try booking
//     if (!publicCode && review.bookingId) {
//       const bookingSnap = await admin
//         .firestore()
//         .collection('bookings')
//         .doc(review.bookingId)
//         .get();
//       if (bookingSnap.exists) {
//         publicCode = bookingSnap.get('publicCode') || null;
//       }
//     }

//     // Create a notification for the vendor (translatable in app)
//     await admin
//       .firestore()
//       .collection('notifications')
//       .add({
//         userId: review.vendorId,
//         type: 'new_review',
//         reviewId: context.params.reviewId,
//         foodItemId: review.foodItemId || null,
//         clientName: review.clientName || null,
//         hideClientName: review.hideClientName || false,
//         publicCode: publicCode,
//         orderId: review.orderId || null,
//         bookingId: review.bookingId || null,
//         createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       });

//     return null;
//   });

// export const notifyVendorOnReviewUpdate = functions.firestore
//   .document('reviews/{reviewId}')
//   .onUpdate(async (change, context) => {
//     const before = change.before.data();
//     const after = change.after.data();

//     // Only notify if the comment, photos, videos, or hideClientName changed
//     if (
//       before.comment === after.comment &&
//       JSON.stringify(before.photos) === JSON.stringify(after.photos) &&
//       JSON.stringify(before.videos) === JSON.stringify(after.videos) &&
//       before.hideClientName === after.hideClientName
//     ) {
//       return null; // No relevant change
//     }

//     // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
//     const shouldSend = await shouldSendNotification(
//       after.vendorId,
//       'reviewUpdate',
//     );
//     if (!shouldSend) {
//       console.log(
//         `Skipping review_update notification for vendor ${after.vendorId} - disabled in preferences`,
//       );
//       return null;
//     }

//     // Fetch the order's or booking's publicCode using orderId or bookingId from the review
//     let publicCode = null;
//     if (after.orderId) {
//       const orderSnap = await admin
//         .firestore()
//         .collection('orders')
//         .doc(after.orderId)
//         .get();
//       if (orderSnap.exists) {
//         publicCode = orderSnap.get('publicCode') || null;
//       }
//     }
//     if (!publicCode && after.bookingId) {
//       const bookingSnap = await admin
//         .firestore()
//         .collection('bookings')
//         .doc(after.bookingId)
//         .get();
//       if (bookingSnap.exists) {
//         publicCode = bookingSnap.get('publicCode') || null;
//       }
//     }

//     await admin
//       .firestore()
//       .collection('notifications')
//       .add({
//         userId: after.vendorId,
//         type: 'review_update',
//         reviewId: context.params.reviewId,
//         foodItemId: after.foodItemId || null,
//         clientName: after.clientName || null,
//         hideClientName: after.hideClientName || false,
//         publicCode: publicCode,
//         orderId: after.orderId || null,
//         bookingId: after.bookingId || null,
//         createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       });

//     return null;
//   });

// export const decrementReviewsCountOnReviewDelete = functions.firestore
//   .document('reviews/{reviewId}')
//   .onDelete(async (snap, context) => {
//     const review = snap.data();
//     const batch = admin.firestore().batch();

//     // Decrement vendor's reviewsCount and delete vendor rating doc if this is a vendor review (no foodItemId)
//     if (review.vendorId && !review.foodItemId) {
//       const vendorRef = admin
//         .firestore()
//         .collection('users')
//         .doc(review.vendorId);
//       batch.update(vendorRef, {
//         reviewsCount: admin.firestore.FieldValue.increment(-1),
//       });

//       // Also delete the vendor's rating doc for this client
//       if (review.clientId) {
//         const ratingRef = admin
//           .firestore()
//           .collection('users')
//           .doc(review.vendorId)
//           .collection('ratings')
//           .doc(review.clientId);
//         batch.delete(ratingRef);
//       }
//     }

//     // Decrement food item's reviewsCount and delete food item rating doc if this is a food review
//     if (review.foodItemId) {
//       const foodItemRef = admin
//         .firestore()
//         .collection('foodItems')
//         .doc(review.foodItemId);
//       batch.update(foodItemRef, {
//         reviewsCount: admin.firestore.FieldValue.increment(-1),
//       });

//       // Also delete the food item's rating doc for this client
//       if (review.clientId) {
//         const foodRatingRef = admin
//           .firestore()
//           .collection('foodItems')
//           .doc(review.foodItemId)
//           .collection('ratings')
//           .doc(review.clientId);
//         batch.delete(foodRatingRef);
//       }
//     }

//     await batch.commit();
//     return null;
//   });

// export const notifyClientOnVendorResponse = functions.firestore
//   .document('reviews/{reviewId}')
//   .onUpdate(async (change, context) => {
//     const before = change.before.data();
//     const after = change.after.data();

//     // Only notify if the response was added or changed
//     if (
//       (!before.response && after.response) ||
//       before.response?.text !== after.response?.text
//     ) {
//       // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
//       const shouldSend = await shouldSendNotification(
//         after.clientId,
//         'vendorResponse',
//       );
//       if (!shouldSend) {
//         console.log(
//           `Skipping vendor_response notification for client ${after.clientId} - disabled in preferences`,
//         );
//         return null;
//       }

//       // Fetch vendor name
//       let vendorName = '';
//       if (after.vendorId) {
//         const vendorDoc = await admin
//           .firestore()
//           .collection('users')
//           .doc(after.vendorId)
//           .get();
//         vendorName = vendorDoc.exists ? vendorDoc.get('name') || '' : '';
//       }

//       // Fetch publicCode from order or booking when available
//       let publicCode = null;
//       if (after.orderId) {
//         const orderSnap = await admin
//           .firestore()
//           .collection('orders')
//           .doc(after.orderId)
//           .get();
//         if (orderSnap.exists) publicCode = orderSnap.get('publicCode') || null;
//       }
//       if (!publicCode && after.bookingId) {
//         const bookingSnap = await admin
//           .firestore()
//           .collection('bookings')
//           .doc(after.bookingId)
//           .get();
//         if (bookingSnap.exists) publicCode = bookingSnap.get('publicCode') || null;
//       }

//       await admin
//         .firestore()
//         .collection('notifications')
//         .add({
//           userId: after.clientId,
//           type: 'vendor_response',
//           reviewId: context.params.reviewId,
//           vendorId: after.vendorId,
//           vendorName: vendorName,
//           foodItemId: after.foodItemId || null,
//           publicCode: publicCode || after.publicCode || null,
//           hideClientName: after.hideClientName || false,
//           clientName: after.clientName || null,
//           responseText: after.response?.text || '',
//           createdAt: admin.firestore.FieldValue.serverTimestamp(),
//           timestamp: admin.firestore.FieldValue.serverTimestamp(),
//           read: false,
//         });
//     }
//     return null;
//   });

// export const notifyClientToReviewVendor = functions.firestore
//   .document('orders/{orderId}')
//   .onUpdate(async (change, context) => {
//     const before = change.before.data();
//     const after = change.after.data();

//     // Only proceed if status changed to 'delivered'
//     if (before.status === after.status || after.status !== 'delivered') {
//       return null;
//     }

//     // Get clientId and vendorId
//     const clientId = after.clientId;
//     const vendorId = after.vendorId;
//     if (!clientId || !vendorId) return null;

//     // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
//     const shouldSend = await shouldSendNotification(
//       clientId,
//       'request_vendor_review',
//     );
//     if (!shouldSend) {
//       console.log(
//         `Skipping request_vendor_review notification for client ${clientId} - disabled in preferences`,
//       );
//       return null;
//     }

//     // Get order public code
//     const publicCode = after.publicCode || '';
//     const reviewTimestamp = new Date(Date.now() + 1000); // 1 second later

//     // Create a notification for the client to review the vendor
//     await admin.firestore().collection('notifications').add({
//       userId: clientId,
//       type: 'request_vendor_review',
//       vendorId: vendorId,
//       orderId: context.params.orderId,
//       publicCode: publicCode,
//       createdAt: admin.firestore.FieldValue.serverTimestamp(),
//       timestamp: reviewTimestamp,
//       read: false,
//     });

//     return null;
//   });

// // export const rewardInviterOnVendorSubscription = functions.firestore
// //   .document("users/{vendorId}")
// //   .onUpdate(async (change, context) => {
// //     const before = change.before.data();
// //     const after = change.after.data();

// //     // Only proceed if role is vendor and menuSlots changed from falsy to truthy (subscription activated)
// //     if (
// //       after.role !== "vendor" ||
// //       !after.invitedBy ||
// //       before.menuSlots === after.menuSlots || // No change
// //       !after.menuSlots || // Not activated
// //       after.referralRewarded // Already rewarded
// //     ) {
// //       return null;
// //     }

// //     // Find inviter by referralCode
// //     const inviterQuery = await admin
// //       .firestore()
// //       .collection("users")
// //       .where("referralCode", "==", after.invitedBy)
// //       .limit(1)
// //       .get();

// //     if (inviterQuery.empty) {
// //       console.log(`No inviter found with referralCode: ${after.invitedBy}`);
// //       return null;
// //     }

// //     const inviterDoc = inviterQuery.docs[0];
// //     const inviterRef = inviterDoc.ref;
// //     const inviterId = inviterDoc.id;
// //     const inviterFcmToken = inviterDoc.get("fcmToken");

// //     // Add 15 credits to inviter
// //     const creditsToAdd = 15;
// //     await inviterRef.update({
// //       credits: admin.firestore.FieldValue.increment(creditsToAdd),
// //     });

// //     // Mark vendor as rewarded so it doesn't trigger again
// //     await change.after.ref.update({ referralRewarded: true });

// //     // Compose full name for notification
// //     const fullName = [after.name, after.lastName].filter(Boolean).join(" ");

// //     // Create notification document
// //     await admin.firestore().collection("notifications").add({
// //       userId: inviterId,
// //       type: "referral",
// //       creditsEarned: creditsToAdd,
// //       invitedPerson: fullName,
// //       createdAt: admin.firestore.FieldValue.serverTimestamp(),
// //       timestamp: admin.firestore.FieldValue.serverTimestamp(),
// //       read: false,
// //     });

// //     // Optionally, send push notification
// //     if (inviterFcmToken) {
// //       const payload = {
// //         notification: {
// //           title: "Referral Bonus!",
// //           body: "", // Let app translate
// //         },
// //         token: inviterFcmToken,
// //         data: {
// //           type: "referral",
// //           creditsEarned: String(creditsToAdd),
// //           invitedPerson: fullName,
// //         },
// //       };

// //       try {
// //         await admin.messaging().send(payload);
// //         console.log(`Push notification sent to inviter ${inviterId}`);
// //       } catch (err) {
// //         console.error("Error sending push notification:", err);
// //       }
// //     }

// //     console.log(
// //       `Allocated ${creditsToAdd} credits to inviter ${inviterId} for vendor ${context.params.vendorId}'s subscription`
// //     );
// //     return null;
// //   });

// export const rewardInviterOnVendorFirstFoodItem = functions.firestore
//   .document('foodItems/{foodItemId}')
//   .onCreate(async (snap, context) => {
//     const foodItem = snap.data();
//     if (!foodItem) return null;

//     const vendorId = foodItem.vendorId;
//     if (!vendorId) {
//       console.log('Food item has no vendorId, skipping referral reward.');
//       return null;
//     }

//     const vendorRef = admin.firestore().collection('users').doc(vendorId);
//     const vendorDoc = await vendorRef.get();
//     if (!vendorDoc.exists) {
//       console.log(`Vendor ${vendorId} not found`);
//       return null;
//     }
//     const vendorData = vendorDoc.data();

//     // Only proceed if vendor was invited and not already rewarded
//     const invitedBy = vendorData?.invitedBy;
//     if (!invitedBy) {
//       console.log(
//         `Vendor ${vendorId} was not invited, skipping referral reward.`,
//       );
//       return null;
//     }
//     if (vendorData?.referralRewarded) {
//       console.log(
//         `Vendor ${vendorId} already triggered referral reward, skipping.`,
//       );
//       return null;
//     }

//     // Find inviter by referralCode
//     const inviterQuery = await admin
//       .firestore()
//       .collection('users')
//       .where('referralCode', '==', invitedBy)
//       .limit(1)
//       .get();

//     if (inviterQuery.empty) {
//       console.log(`No inviter found with referralCode: ${invitedBy}`);
//       return null;
//     }

//     const inviterDoc = inviterQuery.docs[0];
//     const inviterRef = inviterDoc.ref;
//     const inviterId = inviterDoc.id;

//     const creditsToAdd = 10;

//     // Use transaction to avoid race conditions (e.g., multiple food items created concurrently)
//     try {
//       await admin.firestore().runTransaction(async tx => {
//         const freshVendorSnap = await tx.get(vendorRef);
//         if (!freshVendorSnap.exists) throw new Error('Vendor doc disappeared');
//         const freshVendor = freshVendorSnap.data();
//         if (freshVendor?.referralRewarded) {
//           throw new Error('Already rewarded in concurrent transaction');
//         }

//         tx.update(inviterRef, {
//           credits: admin.firestore.FieldValue.increment(creditsToAdd),
//         });

//         tx.update(vendorRef, {
//           referralRewarded: true,
//         });
//       });
//     } catch (err) {
//       // If transaction failed because already rewarded, quietly exit
//       if (String(err).includes('Already rewarded')) {
//         console.log('Referral already rewarded by concurrent transaction.');
//         return null;
//       }
//       console.error('Transaction error rewarding inviter:', err);
//       return null;
//     }

//     // Compose full name for notification
//     const fullName = [vendorData?.name, vendorData?.lastName]
//       .filter(Boolean)
//       .join(' ');

//     // Create notification document
//     await admin.firestore().collection('notifications').add({
//       userId: inviterId,
//       type: 'referral',
//       creditsEarned: creditsToAdd,
//       invitedPerson: fullName,
//       createdAt: admin.firestore.FieldValue.serverTimestamp(),
//       timestamp: admin.firestore.FieldValue.serverTimestamp(),
//       read: false,
//     });

//     // Optionally send push notification to inviter
//     try {
//       await sendPushWithBadge(inviterId, {
//         notification: {title: 'Referral Bonus!', body: ''},
//         data: {
//           type: 'referral',
//           creditsEarned: String(creditsToAdd),
//           invitedPerson: fullName,
//         },
//       });
//       console.log(`Attempted push notification to inviter ${inviterId}`);
//     } catch (err) {
//       console.error('Error sending push via helper:', err);
//     }

//     console.log(
//       `Allocated ${creditsToAdd} credits to inviter ${inviterId} for vendor ${vendorId}'s first food item`,
//     );
//     return null;
//   });

// // Aggregate vendor ratings when a rating is added/updated/deleted
// export const aggregateVendorRatings = functions.firestore
//   .document('users/{vendorId}/ratings/{clientId}')
//   .onWrite(async (change, context) => {
//     console.log('Vendor rating aggregation triggered!');

//     const vendorId = context.params.vendorId;
//     const ratingsRef = admin
//       .firestore()
//       .collection('users')
//       .doc(vendorId)
//       .collection('ratings');
//     const vendorRef = admin.firestore().collection('users').doc(vendorId);

//     const ratingsSnapshot = await ratingsRef.get();
//     let total = 0;
//     let count = 0;

//     ratingsSnapshot.forEach(doc => {
//       const data = doc.data();
//       if (typeof data.stars === 'number') {
//         total += data.stars;
//         count += 1;
//       }
//     });

//     const average = count > 0 ? total / count : 0;

//     try {
//       await vendorRef.update({
//         rating: average,
//         totalRatings: count,
//       });
//       console.log(
//         `Updated vendor ${vendorId}: rating=${average}, totalRatings=${count}`,
//       );
//     } catch (error) {
//       console.error('Error updating vendor rating:', error);
//     }

//     return null;
//   });

//   // Ensure review ratings are mirrored into ratings subcollections so aggregation works
//   export const syncReviewToRatings = functions.firestore
//     .document('reviews/{reviewId}')
//     .onCreate(async (snap, context) => {
//       const review = snap.data();
//       if (!review) return null;

//       const clientId = review.clientId;
//       const rating = review.rating;
//       if (!clientId || typeof rating !== 'number') return null;

//       const batch = admin.firestore().batch();

//       // Vendor-level rating (only when review is not a food-item review)
//       if (review.vendorId && !review.foodItemId) {
//         const vendorRatingRef = admin
//           .firestore()
//           .collection('users')
//           .doc(review.vendorId)
//           .collection('ratings')
//           .doc(clientId);
//         const existing = await vendorRatingRef.get();
//         if (!existing.exists) {
//           batch.set(vendorRatingRef, {
//             stars: rating,
//             reviewId: context.params.reviewId,
//             createdAt: admin.firestore.FieldValue.serverTimestamp(),
//           });
//         }
//       }

//       // Food-item rating
//       if (review.foodItemId) {
//         const foodRatingRef = admin
//           .firestore()
//           .collection('foodItems')
//           .doc(review.foodItemId)
//           .collection('ratings')
//           .doc(clientId);
//         const existingFood = await foodRatingRef.get();
//         if (!existingFood.exists) {
//           batch.set(foodRatingRef, {
//             stars: rating,
//             reviewId: context.params.reviewId,
//             createdAt: admin.firestore.FieldValue.serverTimestamp(),
//           });
//         }
//       }

//       if ((batch as any)._ops && (batch as any)._ops.length === 0) {
//         // No writes queued
//         return null;
//       }

//       try {
//         await batch.commit();
//       } catch (e) {
//         console.error('Failed to sync review to ratings:', e);
//       }
//       return null;
//     });

// export const notifyAdminOnSubscriptionReceipt = functions.firestore
//   .document('subscriptionPayments/{receiptId}')
//   .onCreate(async (snap, context) => {
//     const data = snap.data();
//     if (!data || data.status !== 'pending') return null;

//     // Get your email credentials from Firebase config
//     const adminEmail = 'samansaeedi102@gmail.com'; // Change to your admin email
//     const yahooEmail = (await GMAIL_EMAIL.value()) || '';
//     const yahooPassword = await GMAIL_PASSWORD.value();

//     if (!yahooEmail || !yahooPassword) {
//       console.error('❌ Yahoo credentials not configured');
//       throw new Error('Yahoo credentials not configured');
//     }

//     // Create transporter using Yahoo
//     const transporter = nodemailer.createTransport({
//       service: 'yahoo',
//       auth: {
//         user: yahooEmail,
//         pass: yahooPassword,
//       },
//     });

//     const mailOptions = {
//       from: yahooEmail,
//       to: adminEmail,
//       subject: `💳 New Vendor Subscription Payment - ${data.vendorId}`,
//       html: `
//     <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//       <h2>New Subscription Payment Receipt Submitted</h2>
//       <table style="width: 100%; border-collapse: collapse;">
//         <tr><td><b>Receipt ID:</b></td><td>${context.params.receiptId}</td></tr>
//         <tr><td><b>Vendor ID:</b></td><td>${data.vendorId}</td></tr>
//         <tr><td><b>Plan:</b></td><td>${data.plan}</td></tr>
//         <tr><td><b>Amount:</b></td><td>${data.amount} €</td></tr>
//         <tr><td><b>Payment Method:</b></td><td>${data.paymentMethod}</td></tr>
//         <tr><td><b>Created At:</b></td><td>${data.createdAt}</td></tr>
//         <tr><td><b>Receipt Image:</b></td><td><a href="${data.proofUrl}">View Image</a></td></tr>
//       </table>
//       <p>
//         <a href="https://console.firebase.google.com/project/YOUR_PROJECT_ID/firestore/data/~2FsubscriptionPayments~2F${context.params.receiptId}">
//           🔗 View this receipt in Firestore
//         </a>
//       </p>
//     </div>
//   `,
//     };

//     try {
//       await transporter.sendMail(mailOptions);
//       console.log('✅ Admin notified about new subscription payment receipt');
//     } catch (error) {
//       console.error('❌ Failed to send admin email:', error);
//     }

//     return null;
//   });

// // Aggregate food item ratings when a rating is added/updated/deleted
// export const aggregateFoodItemRatings = functions.firestore
//   .document('foodItems/{foodItemId}/ratings/{clientId}')
//   .onWrite(async (change, context) => {
//     console.log('Food item rating aggregation triggered!');

//     const foodItemId = context.params.foodItemId;
//     const foodItemRef = admin
//       .firestore()
//       .collection('foodItems')
//       .doc(foodItemId);
//     const ratingsSnap = await foodItemRef.collection('ratings').get();

//     let totalStars = 0;
//     let totalRatings = ratingsSnap.size;

//     ratingsSnap.forEach(doc => {
//       const data = doc.data();
//       if (typeof data.stars === 'number') {
//         totalStars += data.stars;
//       }
//     });

//     const avgRating = totalRatings > 0 ? totalStars / totalRatings : 0;

//     await foodItemRef.update({
//       rating: Math.round(avgRating * 10) / 10, // round to 1 decimal
//       totalRatings: totalRatings,
//     });

//     console.log(
//       `Updated food item ${foodItemId}: rating=${avgRating}, totalRatings=${totalRatings}`,
//     );
//   });

// // Notify vendor when a new order is created
// export const notifyVendorOnNewOrder = functions.firestore
//   .document('orders/{orderId}')
//   .onCreate(async (snap, context) => {
//     const order = snap.data();
//     if (!order) return null;

//     const vendorId = order.vendorId;
//     const clientName = order.clientName || '';
//     const publicCode = order.publicCode || ''; // ✅ This gets the publicCode from the order
//     const orderId = context.params.orderId;

//     if (!vendorId) {
//       console.log('No vendor ID found for order');
//       return null;
//     }

//     // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
//     const shouldSend = await shouldSendNotification(vendorId, 'newOrder');
//     if (!shouldSend) {
//       console.log(
//         `Skipping new order notification for vendor ${vendorId} - disabled in preferences`,
//       );
//       return null;
//     }

//     try {
//       // Create notification for vendor
//       await admin.firestore().collection('notifications').add({
//         userId: vendorId,
//         type: 'newOrder',
//         orderId: orderId,
//         publicCode: publicCode, // ✅ Now publicCode will be available
//         clientName: clientName,
//         createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       });

//       console.log(
//         `New order notification created for vendor ${vendorId}, order ${
//           publicCode || orderId
//         }`,
//       );
//     } catch (error) {
//       console.error('Error creating new order notification:', error);
//     }

//     return null;
//   });

// // Notify client when order status changes
// export const notifyClientOnOrderStatusChange = functions.firestore
//   .document('orders/{orderId}')
//   .onUpdate(async (change, context) => {
//     const before = change.before.data();
//     const after = change.after.data();

//     // Only proceed if status actually changed
//     if (before.status === after.status) {
//       return null;
//     }

//     const clientId = after.clientId;
//     const orderId = context.params.orderId;
//     const publicCode = after.publicCode || orderId;
//     const clientName = after.clientInfo?.name
//       ? `${after.clientInfo.name} ${after.clientInfo.lastName || ''}`.trim()
//       : after.clientName || '';

//     if (!clientId) {
//       console.log('No client ID found for order');
//       return null;
//     }

//     // Determine notification type based on new status
//     let notificationType = '';

//     switch (after.status) {
//       case 'accepted':
//         notificationType = 'orderAccepted';
//         break;
//       case 'rejected':
//         notificationType = 'orderRejected';
//         break;
//       case 'delivered':
//         notificationType = 'orderDelivered';
//         break;
//       case 'expired':
//         // New: map an expired order to an orderExpired notification
//         notificationType = 'orderExpired';
//         break;
//       default:
//         console.log(`No notification needed for status: ${after.status}`);
//         return null;
//     }

//     // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
//     const shouldSend = await shouldSendNotification(clientId, notificationType);
//     if (!shouldSend) {
//       console.log(
//         `Skipping ${notificationType} notification for client ${clientId} - disabled in preferences`,
//       );
//       return null;
//     }

//     try {
//       // ✅ CREATE NOTIFICATION DATA WITH ALL FIELDS DEFINED UPFRONT
//       let notificationData: any = {
//         userId: clientId,
//         type: notificationType,
//         orderId: orderId,
//         publicCode: publicCode,
//         clientName: clientName,
//         vendorId: after.vendorId,
//         rejectionReason: after.rejectionReason || null,
//         createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       };

//       // ✅ ADD TYPE-SPECIFIC FIELDS BASED ON STATUS
//       if (notificationType === 'orderAccepted') {
//         const deliveryDate = after.deliveryDate || after.selectedDate;
//         notificationData = {
//           ...notificationData,
//           deliveryDate: deliveryDate || null,
//           delivered: false,
//         };
//       } else if (notificationType === 'orderDelivered') {
//         notificationData = {
//           ...notificationData,
//           delivered: true,
//         };
//       } else if (notificationType === 'orderExpired') {
//         // Include expiry-specific metadata so the app can display a translated message
//         notificationData = {
//           ...notificationData,
//           expired: true,
//           expiredAt:
//             after.expiredAt || admin.firestore.FieldValue.serverTimestamp(),
//           expiryReason: after.expiryReason || null,
//         };
//       }

//       // If order was accepted and it's a pickup, mark related holds as accepted
//       if (after.status === 'accepted' && after.deliveryMethod === 'pickup') {
//         try {
//           const holdsQuery = await admin
//             .firestore()
//             .collection('pickupSlotHolds')
//             .where('orderId', '==', orderId)
//             .where('status', '==', 'active')
//             .get();

//           const batch = admin.firestore().batch();
//           holdsQuery.docs.forEach(h => {
//             batch.update(h.ref, {
//               status: 'accepted',
//               acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
//             });
//           });

//           await batch.commit();
//           console.log(
//             `Accepted ${holdsQuery.size} pickup holds for order ${orderId}`,
//           );
//         } catch (err) {
//           console.error(
//             'Failed to confirm pickup holds for accepted order:',
//             err,
//           );
//         }
//       }

//       // Create notification for client
//       await admin.firestore().collection('notifications').add(notificationData);

//       console.log(
//         `${notificationType} notification created for client ${clientId}, order ${publicCode}`,
//       );
//     } catch (error) {
//       console.error(`Error creating ${notificationType} notification:`, error);
//     }

//     return null;
//   });

// // Send push notification when a new notification is created
// // export const sendPushOnNotificationCreate = functions.firestore
// //   .document('notifications/{notificationId}')
// //   .onCreate(async (snap: functions.firestore.DocumentSnapshot) => {
// //     console.log('Notification push function triggered!');

// //     const notification = snap.data();
// //     if (!notification) {
// //       console.log('No notification data found.');
// //       return null;
// //     }

// //     const userId = notification.userId;
// //     const message = notification.message;
// //     const notificationType = notification.type || 'general';
// //     const orderId = notification.orderId;
// //     const publicCode = notification.publicCode;

// //     // ✅ CHECK USER PREFERENCES BEFORE SENDING
// //     const shouldSend = await shouldSendNotification(userId, notificationType);
// //     if (!shouldSend) {
// //       console.log(
// //         `Skipping notification for user ${userId}, type ${notificationType} - disabled in preferences`,
// //       );
// //       return null;
// //     }

// //     // Fetch user role for payload (helper will read tokens)
// //     const userDoc = await admin
// //       .firestore()
// //       .collection('users')
// //       .doc(userId)
// //       .get();
// //     const userRole = userDoc.exists
// //       ? userDoc.get('role') || 'client'
// //       : 'client';

// //     // Determine notification title and body based on type
// //     let notificationTitle = 'New Notification';
// //     let notificationBody = message;

// //     switch (notificationType) {
// //       case 'chat_message':
// //         notificationTitle = 'New Message';
// //         break;
// //       case 'orderAccepted':
// //         notificationTitle = 'Order Accepted';
// //         notificationBody = `Your order ${
// //           publicCode || orderId || ''
// //         } has been accepted`;
// //         break;
// //       case 'orderRejected':
// //         notificationTitle = 'Order Rejected';
// //         notificationBody = `Your order ${
// //           publicCode || orderId || ''
// //         } has been rejected`;
// //         break;
// //       case 'newOrder':
// //         notificationTitle = 'New Order';
// //         notificationBody = `You have a new order ${
// //           publicCode || orderId || ''
// //         }`;
// //         break;
// //       case 'orderDelivered':
// //         notificationTitle = 'Order Delivered';
// //         notificationBody = `Your order ${
// //           publicCode || orderId || ''
// //         } has been delivered`;
// //         break;
// //       case 'referral':
// //         notificationTitle = 'Referral Bonus!';
// //         break;
// //       case 'referral_pending':
// //         notificationTitle = 'Referral Update';
// //         if (notification.role === 'vendor') {
// //           notificationBody = `${notification.invitedPerson} registered with your invitation! You will receive 15 credits when they complete their first subscription`;
// //         } else {
// //           notificationBody = `${notification.invitedPerson} registered with your invitation! You will receive 5 credits when they place and complete their first order`;
// //         }
// //         break;
// //       case 'new_review':
// //         notificationTitle = 'New Review';
// //         notificationBody = '';
// //         break;
// //       case 'review_update':
// //         notificationTitle = 'Review Updated';
// //         notificationBody = '';
// //         break;
// //       case 'review_deleted':
// //         notificationTitle = 'Review Deleted';
// //         notificationBody = '';
// //         break;
// //       case 'vendor_response':
// //         notificationTitle = 'Vendor Responded';
// //         notificationBody = 'The vendor has responded to your review.';
// //         break;
// //       case 'request_vendor_review':
// //         notificationTitle = 'Review Your Vendor';
// //         notificationBody = `Please leave a review for order ${
// //           publicCode || orderId || ''
// //         }`;
// //         break;
// //       // Booking notification cases
// //       case 'newBooking':
// //         notificationTitle = 'New Booking';
// //         notificationBody = `You have a new table booking from ${
// //           notification.clientName || 'a client'
// //         }`;
// //         break;
// //       case 'bookingAccepted':
// //         notificationTitle = 'Booking Accepted';
// //         notificationBody = `Your table booking has been accepted`;
// //         break;
// //       case 'bookingRejected':
// //         notificationTitle = 'Booking Rejected';
// //         notificationBody = `Your table booking has been rejected`;
// //         break;
// //       case 'bookingCancelled':
// //         notificationTitle = 'Booking Cancelled';
// //         notificationBody = `Your table booking has been cancelled`;
// //         break;
// //       case 'bookingCompleted':
// //         notificationTitle = 'Booking Completed';
// //         notificationBody = `Your table booking has been completed`;
// //         break;
// //       case 'bookingConflictCancellation':
// //         notificationTitle = 'Booking Cancelled';
// //         notificationBody = `Your booking was cancelled due to an order conflict`;
// //         break;
// //       case 'bookingReminder':
// //         notificationTitle = 'Booking Reminder';
// //         notificationBody = `Reminder: You have a booking today`;
// //         break;
// //       case 'vendorBookingReminder':
// //         notificationTitle = "Today's Bookings";
// //         notificationBody = `You have ${notification.bookingCount || 1} booking${
// //           (notification.bookingCount || 1) > 1 ? 's' : ''
// //         } today`;
// //         break;
// //       case 'request_booking_review':
// //         notificationTitle = 'Review Your Experience';
// //         notificationBody = `Please leave a review for your recent booking`;
// //         break;
// //       default:
// //         notificationTitle = 'Food Delivery Update';
// //         break;
// //     }

// //     // Build base payload and delegate to helper (helper will compute badge)
// //     const basePayload: Partial<admin.messaging.Message> = {
// //       notification: {title: notificationTitle, body: notificationBody},
// //       data: {
// //         title: notificationTitle,
// //         body: notificationBody,
// //         type: notificationType,
// //         userRole: userRole,
// //         orderId: orderId || '',
// //         publicCode: publicCode || '',
// //         userId: userId,
// //         notificationId: snap.id, // deterministic id for client-side cancellation
// //       },
// //       android: {
// //         notification: {
// //           title: notificationTitle,
// //           body: notificationBody,
// //           icon: 'ic_notification',
// //           color: '#FF6B35',
// //           sound: 'default',
// //           tag: snap.id, // set tag so Android notification can be cancelled by id
// //         },
// //         priority: 'high' as const,
// //       },
// //       apns: {
// //         payload: {
// //           aps: {
// //             alert: {title: notificationTitle, body: notificationBody},
// //             sound: 'default',
// //           },
// //         },
// //       },
// //     };

// //     try {
// //       await sendPushWithBadge(userId, basePayload);
// //       console.log('Dispatched push via helper for user:', userId);
// //     } catch (error) {
// //       console.error('Error dispatching push via helper:', error);
// //     }

// //     return null;
// //   });

// export const sendPushOnNotificationCreate = functions.firestore
//   .document('notifications/{notificationId}')
//   .onCreate(async (snap: functions.firestore.DocumentSnapshot) => {
//     console.log('Notification push function triggered!');

//     const notification = snap.data();
//     if (!notification) {
//       console.log('No notification data found.');
//       return null;
//     }

//     const userId = notification.userId;
//     if (!userId) {
//       console.log('Notification missing userId, skipping push.');
//       return null;
//     }

//     const notificationType = notification.type || 'general';

//     // Respect user preferences
//     const shouldSend = await shouldSendNotification(userId, notificationType);
//     if (!shouldSend) {
//       console.log(
//         `Skipping notification for user ${userId}, type ${notificationType} - disabled in preferences`,
//       );
//       return null;
//     }

//     // Fetch role (helper may use tokens + badge logic)
//     const userDoc = await admin
//       .firestore()
//       .collection('users')
//       .doc(userId)
//       .get();
//     const userRole = userDoc.exists
//       ? userDoc.get('role') || 'client'
//       : 'client';

//     // Build a data-only payload. Client will localize / render title/body from `type` + `payload`.
//     const dataPayload: Record<string, string> = {
//       type: String(notificationType),
//       userId: String(userId),
//       userRole: String(userRole),
//       message: String(notification.message || ''),
//       orderId: String(notification.orderId || ''),
//       publicCode: String(notification.publicCode || ''),
//       // stringify full notification so client has every field available for interpolation
//       payload: JSON.stringify(notification),
//     };

//     // Add a few commonly-used fields if present
//     if (notification.invitedPerson)
//       dataPayload.invitedPerson = String(notification.invitedPerson);
//     if (notification.creditsEarned)
//       dataPayload.creditsEarned = String(notification.creditsEarned);
//     if (notification.vendorName)
//       dataPayload.vendorName = String(notification.vendorName);
//     if (notification.clientName)
//       dataPayload.clientName = String(notification.clientName);

//     const basePayload: Partial<admin.messaging.Message> = {
//       data: dataPayload,
//       android: {priority: 'high' as const},
//       apns: {payload: {aps: {'content-available': 1}}},
//     };

//     try {
//       await sendPushWithBadge(userId, basePayload);
//       console.log('Dispatched push via helper for user:', userId);
//     } catch (error) {
//       console.error('Error dispatching push via helper:', error);
//     }

//     return null;
//   });

// export const sendChatPushNotification = functions.https.onCall(
//   async (data, context) => {
//     console.log('Chat push notification function triggered!');

//     if (!context.auth) {
//       throw new functions.https.HttpsError(
//         'unauthenticated',
//         'User must be authenticated',
//       );
//     }

//     const {recipientId, senderName, message, conversationId} = data || {};

//     if (!recipientId || !senderName || !message) {
//       throw new functions.https.HttpsError(
//         'invalid-argument',
//         'recipientId, senderName, and message are required',
//       );
//     }

//     // Respect user preferences for chat messages
//     const shouldSend = await shouldSendNotification(recipientId, 'chatMessage');
//     if (!shouldSend) {
//       console.log(
//         `Skipping chat notification for user ${recipientId} - disabled in preferences`,
//       );
//       return {success: false, reason: 'Chat notifications disabled by user'};
//     }

//     try {
//       // Fetch recipient doc
//       const userDoc = await admin
//         .firestore()
//         .collection('users')
//         .doc(recipientId)
//         .get();

//       const fcmToken = userDoc.exists ? userDoc.get('fcmToken') : null;
//       const userRole = userDoc.exists
//         ? userDoc.get('role') || 'client'
//         : 'client';

//       console.log('FCM token retrieved:', fcmToken);

//       if (!fcmToken) {
//         console.log('No FCM token found for user:', recipientId);
//         return {success: false, reason: 'No FCM token found'};
//       }

//       // Build notification payload
//       const notificationTitle = 'New Message';
//       const notificationBody = `${senderName}: ${
//         typeof message === 'string' && message.length > 50
//           ? message.substring(0, 50) + '...'
//           : message
//       }`;

//       // Send via centralized helper (basePayload built below)
//       const basePayload: Partial<admin.messaging.Message> = {
//         notification: {title: notificationTitle, body: notificationBody},
//         data: {
//           title: notificationTitle,
//           body: notificationBody,
//           type: 'chat_message',
//           senderId: context.auth.uid,
//           senderName,
//           conversationId: conversationId || '',
//           originalMessage: String(message),
//           userRole,
//           // for chat messages we don't create a notification doc here; the conversationId
//           // will be used as the android notification tag so the client can cancel by conversation
//           notificationId: conversationId || '',
//         },
//         android: {
//           notification: {
//             title: notificationTitle,
//             body: notificationBody,
//             icon: 'ic_notification',
//             color: '#FF6B35',
//             tag: conversationId || undefined,
//             sound: 'default',
//           },
//           priority: 'high' as const,
//         },
//         apns: {
//           payload: {
//             aps: {
//               alert: {title: notificationTitle, body: notificationBody},
//               sound: 'default',
//             },
//           },
//         },
//       };

//       try {
//         const res: any = await sendPushWithBadge(recipientId, basePayload);
//         if (res && res.successCount && res.successCount > 0) {
//           return {success: true, messageId: 'multicast'};
//         }
//         return {success: false, reason: 'No devices accepted the message'};
//       } catch (error: any) {
//         console.error('Error sending chat push via helper:', error);
//         return {success: false, error};
//       }
//     } catch (error: any) {
//       console.error('Unexpected error in chat push flow:', error);
//       return {success: false, error};
//     }
//   },
// );

// // Update APNs badge when a notification's `read` flag changes
// export const updateBadgeOnNotificationUpdate = functions.firestore
//   .document('notifications/{notificationId}')
//   .onUpdate(async (change, context) => {
//     try {
//       const before = change.before.data();
//       const after = change.after.data();
//       if (!before || !after) return null;

//       // Only act when `read` changed
//       if (before.read === after.read) return null;

//       const userId = after.userId || before.userId;
//       if (!userId) return null;

//       // Send a badge-only update (helper computes badge)
//       try {
//         await sendPushWithBadge(userId, {data: {type: 'badge_update'}});
//       } catch (err) {
//         // error sending badge update (not logged in production)
//       }
//     } catch (error) {
//       // unexpected error in updateBadgeOnNotificationUpdate (not logged)
//     }
//     return null;
//   });

// // Update order statistics when an order status changes
// // Cloud Function: updateOrderStatistics
// export const updateOrderStatistics = functions.firestore
//   .document('orders/{orderId}')
//   .onWrite(async (change, context) => {
//     console.log('Order statistics update triggered!');

//     const beforeData = change.before.exists ? change.before.data() : null;
//     const afterData = change.after.exists ? change.after.data() : null;

//     // Only process if status changed
//     const beforeStatus = beforeData?.status;
//     const afterStatus = afterData?.status;

//     if (beforeStatus === afterStatus) {
//       return null;
//     }

//     // Use vendorId from afterData if exists, else from beforeData (for deletions)
//     const vendorId = afterData ? afterData.vendorId : beforeData?.vendorId;
//     if (!vendorId) {
//       console.log('No vendor ID found for order');
//       return null;
//     }

//     try {
//       const vendorRef = admin.firestore().collection('users').doc(vendorId);
//       const vendorDoc = await vendorRef.get();
//       const vendorData = vendorDoc.data();

//       if (!vendorData) {
//         console.log('Vendor not found');
//         return null;
//       }

//       // Initialize statistics if they don't exist
//       const stats = vendorData.orderStatistics || {
//         totalOrders: 0,
//         completedOrders: 0,
//         pendingOrders: 0,
//         rejectedOrders: 0,
//         expiredOrders: 0,
//       };

//       // Handle order deletion
//       if (!afterData) {
//         if (beforeStatus === 'pending') {
//           stats.pendingOrders = Math.max(0, (stats.pendingOrders || 0) - 1);
//         }
//         if (beforeStatus === 'delivered') {
//           stats.completedOrders = Math.max(0, (stats.completedOrders || 0) - 1);
//         }
//         if (beforeStatus === 'rejected') {
//           stats.rejectedOrders = Math.max(0, (stats.rejectedOrders || 0) - 1);
//         }
//         if (beforeStatus === 'expired') {
//           stats.expiredOrders = Math.max(0, (stats.expiredOrders || 0) - 1);
//         }
//         stats.totalOrders = Math.max(0, (stats.totalOrders || 0) - 1);

//         await vendorRef.update({
//           orderStatistics: stats,
//           lastOrderUpdate: admin.firestore.FieldValue.serverTimestamp(),
//         });
//         return null;
//       }

//       // Status transitions
//       if (afterStatus === 'delivered' && beforeStatus !== 'delivered') {
//         stats.completedOrders = (stats.completedOrders || 0) + 1;
//       }
//       if (afterStatus === 'rejected' && beforeStatus !== 'rejected') {
//         stats.rejectedOrders = (stats.rejectedOrders || 0) + 1;
//       }
//       if (afterStatus === 'expired' && beforeStatus !== 'expired') {
//         stats.expiredOrders = (stats.expiredOrders || 0) + 1;
//       }
//       // Only increment pendingOrders on status change to "pending" if not a new order
//       if (
//         beforeStatus !== afterStatus &&
//         afterStatus === 'pending' &&
//         beforeData
//       ) {
//         stats.pendingOrders = (stats.pendingOrders || 0) + 1;
//       }
//       if (afterStatus === 'accepted' && beforeStatus !== 'accepted') {
//         // Transitional state, do nothing
//       }
//       if (beforeStatus === 'delivered' && afterStatus !== 'delivered') {
//         stats.completedOrders = Math.max(0, (stats.completedOrders || 0) - 1);
//       }
//       if (beforeStatus === 'rejected' && afterStatus !== 'rejected') {
//         stats.rejectedOrders = Math.max(0, (stats.rejectedOrders || 0) - 1);
//       }
//       if (beforeStatus === 'expired' && afterStatus !== 'expired') {
//         stats.expiredOrders = Math.max(0, (stats.expiredOrders || 0) - 1);
//       }
//       if (beforeStatus === 'pending' && afterStatus !== 'pending') {
//         stats.pendingOrders = Math.max(0, (stats.pendingOrders || 0) - 1);
//       }
//       if (!beforeData) {
//         stats.totalOrders = (stats.totalOrders || 0) + 1;
//         if (afterStatus === 'pending') {
//           stats.pendingOrders = (stats.pendingOrders || 0) + 1;
//         }
//         if (afterStatus === 'delivered') {
//           stats.completedOrders = (stats.completedOrders || 0) + 1;
//         }
//         if (afterStatus === 'expired') {
//           stats.expiredOrders = (stats.expiredOrders || 0) + 1;
//         }
//       }

//       await vendorRef.update({
//         orderStatistics: stats,
//         lastOrderUpdate: admin.firestore.FieldValue.serverTimestamp(),
//       });

//       console.log(`Updated vendor ${vendorId} statistics:`, stats);
//     } catch (error) {
//       console.error('Error updating order statistics:', error);
//     }

//     return null;
//   });

// export const notifyVendorsOfUpcomingOrders = functions.pubsub
//   .schedule('every day 07:00') // Run every day at 7 AM UTC
//   .timeZone('UTC')
//   .onRun(async _context => {
//     const db = admin.firestore();
//     const now = new Date();
//     now.setHours(0, 0, 0, 0);
//     const twoDaysLater = new Date(now);
//     twoDaysLater.setDate(now.getDate() + 2);

//     // Query orders with deliveryDate in [now, twoDaysLater], status pending or accepted
//     const ordersSnap = await db
//       .collection('orders')
//       .where('deliveryDate', '>=', now.toISOString())
//       .where('deliveryDate', '<=', twoDaysLater.toISOString())
//       .where('status', 'in', ['pending', 'accepted'])
//       .get();

//     if (ordersSnap.empty) {
//       console.log('No upcoming orders found.');
//       return null;
//     }

//     const notifications: any[] = [];

//     for (const doc of ordersSnap.docs) {
//       const order = doc.data();
//       const vendorId = order.vendorId;
//       if (!vendorId) continue;

//       // Check if a notification for this order & vendor already exists (avoid duplicates)
//       const existing = await db
//         .collection('notifications')
//         .where('userId', '==', vendorId)
//         .where('type', '==', 'upcomingOrder')
//         .where('orderId', '==', doc.id)
//         .get();
//       if (!existing.empty) continue;

//       notifications.push({
//         userId: vendorId,
//         type: 'upcomingOrder',
//         orderId: doc.id,
//         publicCode: order.publicCode || '',
//         deliveryDate: order.deliveryDate,
//         clientName: order.clientName || '',
//         createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       });
//     }

//     // Batch create notifications
//     const batch = db.batch();
//     notifications.forEach(notif => {
//       const ref = db.collection('notifications').doc();
//       batch.set(ref, notif);
//     });
//     if (notifications.length > 0) {
//       await batch.commit();
//       console.log(
//         `Created ${notifications.length} upcoming order notifications.`,
//       );
//     }

//     return null;
//   });

// // Clean up old notifications (runs daily)
// export const cleanupOldNotifications = functions.pubsub
//   .schedule('0 2 * * *') // Run at 2 AM daily
//   .timeZone('UTC')
//   .onRun(async (_context: functions.EventContext) => {
//     console.log('Cleaning up old notifications...');

//     const thirtyDaysAgo = new Date();
//     thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

//     try {
//       const oldNotificationsQuery = admin
//         .firestore()
//         .collection('notifications')
//         .where('timestamp', '<', thirtyDaysAgo)
//         .limit(500); // Process in batches

//       const snapshot = await oldNotificationsQuery.get();

//       if (snapshot.empty) {
//         console.log('No old notifications to clean up');
//         return;
//       }

//       const batch = admin.firestore().batch();
//       let count = 0;

//       snapshot.forEach(doc => {
//         batch.delete(doc.ref);
//         count++;
//       });

//       await batch.commit();
//       console.log(`Deleted ${count} old notifications`);
//     } catch (error) {
//       console.error('Error cleaning up old notifications:', error);
//     }
//   });

// // Send email notification to admin when restaurant submits documents
// export const notifyAdminRestaurantSubmission = functions.firestore
//   .document('users/{userId}')
//   .onUpdate(async (change, context) => {
//     console.log('Restaurant submission notification triggered!');

//     const before = change.before.data();
//     const after = change.after.data();
//     const userId = context.params.userId;

//     // Check if this is a restaurant that just submitted documents
//     if (
//       after.role === 'vendor' &&
//       after.type === 'restaurant' &&
//       before.certification?.status !== 'under_review' &&
//       after.certification?.status === 'under_review' &&
//       after.certification?.documentsSubmittedAt
//     ) {
//       console.log(`Restaurant ${userId} submitted documents for review`);

//       const restaurantData = {
//         id: userId,
//         name: `${after.name} ${after.lastName}`,
//         email: after.email,
//         phone: after.phone,
//         location: after.location,
//         description: after.description,
//         submittedAt: after.certification.documentsSubmittedAt,
//         businessLicenseUrl: after.certification.businessLicenseUrl,
//         sanitaryCertificationUrl: after.certification.sanitaryCertificationUrl,
//         workPermitUrl: after.certification.workPermitUrl,
//       };

//       try {
//         // Send email notification
//         await sendAdminEmailWithYahoo(restaurantData);

//         // Also log to admin notifications collection for dashboard
//         await admin
//           .firestore()
//           .collection('adminNotifications')
//           .add({
//             type: 'restaurant_submission',
//             restaurantId: userId,
//             restaurantName: restaurantData.name,
//             restaurantEmail: restaurantData.email,
//             submittedAt: restaurantData.submittedAt,
//             createdAt: admin.firestore.FieldValue.serverTimestamp(),
//             read: false,
//             priority: 'high',
//             message: `New restaurant "${restaurantData.name}" has submitted documents for approval`,
//           });

//         console.log(
//           `✅ Admin notified about restaurant: ${restaurantData.name}`,
//         );
//       } catch (error) {
//         console.error('❌ Failed to notify admin:', error);
//       }
//     }

//     return null;
//   });

// // Helper function to send email using Yahoo Mail
// async function sendAdminEmailWithYahoo(restaurant: any) {
//   const nodemailer = require('nodemailer');

//   // Get Yahoo credentials from Firebase config
//   const yahooEmail = (await GMAIL_EMAIL.value()) || '';
//   const yahooPassword = await GMAIL_PASSWORD.value();

//   if (!yahooEmail || !yahooPassword) {
//     console.error('❌ Yahoo credentials not configured');
//     throw new Error('Yahoo credentials not configured');
//   }

//   // Create transporter using Yahoo
//   const transporter = nodemailer.createTransport({
//     service: 'yahoo',
//     auth: {
//       user: yahooEmail,
//       pass: yahooPassword,
//     },
//   });

//   const adminEmail = 'samansaeedi102@gmail.com'; // Send to your Yahoo email

//   const mailOptions = {
//     from: yahooEmail,
//     to: adminEmail,
//     subject: `🏪 New Restaurant Pending Approval - ${restaurant.name}`,
//     html: `
//       <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//         <div style="background: linear-gradient(135deg, #25567a 0%, #1e4a6b 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
//           <h1 style="margin: 0; font-size: 24px;">🏪 Keetchen Admin Alert</h1>
//           <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">New Restaurant Submission</p>
//         </div>
        
//         <div style="background: white; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 12px 12px; padding: 30px;">
//           <div style="background-color: #f8f9fa; padding: 25px; border-radius: 8px; margin-bottom: 25px;">
//             <h2 style="color: #25567a; margin: 0 0 20px 0; font-size: 20px;">📋 Restaurant Details</h2>
//             <table style="width: 100%; border-collapse: collapse;">
//               <tr style="border-bottom: 1px solid #e9ecef;">
//                 <td style="padding: 8px 0; font-weight: bold; color: #495057;">Name:</td>
//                 <td style="padding: 8px 0; color: #212529;">${
//                   restaurant.name
//                 }</td>
//               </tr>
//               <tr style="border-bottom: 1px solid #e9ecef;">
//                 <td style="padding: 8px 0; font-weight: bold; color: #495057;">Email:</td>
//                 <td style="padding: 8px 0; color: #212529;">${
//                   restaurant.email
//                 }</td>
//               </tr>
//               <tr style="border-bottom: 1px solid #e9ecef;">
//                 <td style="padding: 8px 0; font-weight: bold; color: #495057;">Phone:</td>
//                 <td style="padding: 8px 0; color: #212529;">${
//                   restaurant.phone
//                 }</td>
//               </tr>
//               <tr style="border-bottom: 1px solid #e9ecef;">
//                 <td style="padding: 8px 0; font-weight: bold; color: #495057;">Location:</td>
//                 <td style="padding: 8px 0; color: #212529;">${
//                   restaurant.location?.city
//                 }, ${restaurant.location?.country}</td>
//               </tr>
//               <tr style="border-bottom: 1px solid #e9ecef;">
//                 <td style="padding: 8px 0; font-weight: bold; color: #495057;">Description:</td>
//                 <td style="padding: 8px 0; color: #212529;">${
//                   restaurant.description
//                 }</td>
//               </tr>
//               <tr style="border-bottom: 1px solid #e9ecef;">
//                 <td style="padding: 8px 0; font-weight: bold; color: #495057;">Submitted:</td>
//                 <td style="padding: 8px 0; color: #212529;">${new Date(
//                   restaurant.submittedAt,
//                 ).toLocaleString()}</td>
//               </tr>
//               <tr>
//                 <td style="padding: 8px 0; font-weight: bold; color: #495057;">Restaurant ID:</td>
//                 <td style="padding: 8px 0; color: #212529; font-family: monospace; background: #f1f3f4; padding: 4px 8px; border-radius: 4px;">${
//                   restaurant.id
//                 }</td>
//               </tr>
//             </table>
//           </div>

//           <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 25px; margin-bottom: 25px;">
//             <h3 style="color: #856404; margin: 0 0 15px 0; font-size: 18px;">📄 Documents to Review</h3>
//             <div style="display: flex; flex-direction: column; gap: 12px;">
//               <a href="${restaurant.businessLicenseUrl}" target="_blank" 
//                  style="display: inline-block; background: #25567a; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; text-align: center;">
//                 📄 View Business License
//               </a>
//               <a href="${restaurant.sanitaryCertificationUrl}" target="_blank" 
//                  style="display: inline-block; background: #28a745; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; text-align: center;">
//                 🏥 View Sanitary Certification
//               </a>
//               <a href="${restaurant.workPermitUrl}" target="_blank" 
//                  style="display: inline-block; background: #17a2b8; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; text-align: center;">
//                 🛂 View Work Permit
//               </a>
//             </div>
//           </div>

//           <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; border-radius: 8px; padding: 25px; margin-bottom: 25px;">
//             <h3 style="color: #0c5460; margin: 0 0 15px 0; font-size: 18px;">⚡ Next Steps</h3>
//             <ol style="color: #0c5460; margin: 0; padding-left: 20px;">
//               <li style="margin-bottom: 8px;">Review all uploaded documents by clicking the buttons above</li>
//               <li style="margin-bottom: 8px;">Run your admin verification script: <code style="background: #f8f9fa; padding: 2px 6px; border-radius: 3px;">node verify-restaurants.js</code></li>
//               <li style="margin-bottom: 8px;">Approve or reject the restaurant application</li>
//             </ol>
//           </div>

//           <div style="background-color: #f8f9fa; border-radius: 8px; padding: 20px; text-align: center;">
//             <p style="margin: 0; color: #6c757d; font-size: 14px;">
//               📧 This is an automated notification from Keetchen Admin System
//             </p>
//             <p style="margin: 8px 0 0 0; color: #adb5bd; font-size: 12px;">
//               Restaurant Status: Under Review | Priority: High | ${new Date().toLocaleString()}
//             </p>
//           </div>
//         </div>
//       </div>
//     `,
//   };

//   try {
//     await transporter.sendMail(mailOptions);
//     console.log('✅ Yahoo email sent successfully to:', adminEmail);
//   } catch (error) {
//     console.error('❌ Yahoo email error:', error);
//     throw error;
//   }
// }

// // Add this to your existing index.ts file:

// // Send email notification to vendor when admin approves/rejects restaurant
// export const notifyVendorCertificationUpdate = functions.firestore
//   .document('users/{userId}')
//   .onUpdate(async (change, context) => {
//     console.log('Vendor certification update notification triggered!');

//     const before = change.before.data();
//     const after = change.after.data();
//     const userId = context.params.userId;

//     // Check if this is a restaurant certification status change
//     if (
//       after.role === 'vendor' &&
//       after.type === 'restaurant' &&
//       before.certification?.status !== after.certification?.status &&
//       (after.certification?.status === 'certified' ||
//         after.certification?.status === 'rejected')
//     ) {
//       console.log(
//         `Restaurant ${userId} certification status changed to: ${after.certification.status}`,
//       );

//       const restaurantData = {
//         id: userId,
//         name: `${after.name} ${after.lastName}`,
//         email: after.email,
//         status: after.certification.status,
//         rejectionReason: after.certification.rejectionReason,
//       };

//       try {
//         await sendVendorCertificationEmail(restaurantData);
//         console.log(
//           `✅ Vendor notified about certification: ${restaurantData.status}`,
//         );
//       } catch (error) {
//         console.error('❌ Failed to notify vendor:', error);
//       }
//     }

//     return null;
//   });

// // Helper function to send certification email to vendor
// async function sendVendorCertificationEmail(restaurant: any) {
//   const nodemailer = require('nodemailer');

//   const yahooEmail = (await GMAIL_EMAIL.value()) || '';
//   const yahooPassword = await GMAIL_PASSWORD.value();

//   if (!yahooEmail || !yahooPassword) {
//     throw new Error('Yahoo credentials not configured');
//   }

//   const transporter = nodemailer.createTransport({
//     service: 'yahoo',
//     auth: {
//       user: yahooEmail,
//       pass: yahooPassword,
//     },
//   });

//   const isApproved = restaurant.status === 'certified';
//   const subject = isApproved
//     ? `🎉 Welcome to Keetchen - ${restaurant.name}`
//     : `📄 Document Update Required - ${restaurant.name}`;

//   const mailOptions = {
//     from: yahooEmail,
//     to: restaurant.email,
//     subject: subject,
//     html: generateVendorEmailTemplate(restaurant, isApproved),
//   };

//   await transporter.sendMail(mailOptions);
//   console.log(`✅ Vendor email sent successfully to: ${restaurant.email}`);
// }

// // Email template generator for vendor notifications
// function generateVendorEmailTemplate(restaurant: any, isApproved: boolean) {
//   if (isApproved) {
//     return `
//       <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
        
//         <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center;">
//           <h1 style="margin: 0; font-size: 24px;">🎉 Congratulations!</h1>
//           <p style="margin: 10px 0 0 0; font-size: 16px;">Your restaurant is approved</p>
//         </div>
        
//         <div style="padding: 30px;">
//           <h2 style="color: #28a745; margin: 0 0 20px 0; font-size: 20px; text-align: center;">Welcome to Keetchen!</h2>
          
//           <div style="background: #d4edda; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
//             <h3 style="color: #155724; margin: 0 0 10px 0; font-size: 16px;">✅ You're all set!</h3>
//             <p style="color: #155724; margin: 0; font-size: 14px; line-height: 1.4;">
//               Your restaurant "${restaurant.name}" is now live and ready to receive orders.
//             </p>
//           </div>

//           <div style="background: #fff3cd; border-radius: 8px; padding: 20px; text-align: center;">
//             <p style="color: #856404; margin: 0; font-size: 14px; font-weight: bold;">
//               📱 Restart your Keetchen app to see the updates
//             </p>
//           </div>
//         </div>
//       </div>
//     `;
//   } else {
//     return `
//       <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
        
//         <div style="background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); color: white; padding: 30px; text-align: center;">
//           <h1 style="margin: 0; font-size: 20px;">📄 Update Required</h1>
//           <p style="margin: 10px 0 0 0; font-size: 16px;">Document review completed</p>
//         </div>
        
//         <div style="padding: 30px;">
//           <h2 style="color: #dc3545; margin: 0 0 20px 0; font-size: 18px; text-align: center;">Please resubmit documents</h2>
          
//           <div style="background: #f8d7da; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
//             <h3 style="color: #721c24; margin: 0 0 10px 0; font-size: 16px;">📝 Admin feedback:</h3>
//             <p style="color: #721c24; margin: 0; font-size: 14px; line-height: 1.4;">
//               "${
//                 restaurant.rejectionReason ||
//                 'Please review and resubmit your documents.'
//               }"
//             </p>
//           </div>

//           <div style="background: #d1ecf1; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
//             <h3 style="color: #0c5460; margin: 0 0 10px 0; font-size: 16px;">🔄 What to do:</h3>
//             <p style="color: #0c5460; margin: 0; font-size: 14px; line-height: 1.4;">
//               1. Fix the mentioned issues<br>
//               2. Open your Keetchen app<br>
//               3. Tap "Resubmit Documents"
//             </p>
//           </div>

//           <div style="background: #fff3cd; border-radius: 8px; padding: 20px; text-align: center;">
//             <p style="color: #856404; margin: 0; font-size: 14px; font-weight: bold;">
//               📱 Restart your Keetchen app to see the updates
//             </p>
//           </div>
//         </div>
//       </div>
//     `;
//   }
// }

// export const releaseExpiredHolds = functions.pubsub
//   .schedule('every 1 minutes')
//   .timeZone('UTC')
//   .onRun(async () => {
//     const db = admin.firestore();
//     const now = admin.firestore.Timestamp.now();

//     // Helper: choose a numeric field on a counter doc to increment
//     function chooseNumericField(
//       counterData: FirebaseFirestore.DocumentData | undefined,
//     ) {
//       if (!counterData) return null;
//       const preferred = [
//         'available',
//         'remaining',
//         'count',
//         'qty',
//         'capacity',
//         'slots',
//         'seats',
//         'current',
//         'reserved',
//         'reservedCount',
//       ];
//       for (const p of preferred) {
//         if (typeof counterData[p] === 'number') return p;
//       }
//       // fallback: pick any numeric field
//       for (const k of Object.keys(counterData)) {
//         if (typeof counterData[k] === 'number') return k;
//       }
//       return null;
//     }

//     // Process one collection (orders/bookings)
//     async function processCollection(collectionPath: string) {
//       const batchSize = 300;
//       let lastSnapshotSize = 0;

//       // Query loop to handle many expired docs in pages
//       const queryBase = db
//         .collection(collectionPath)
//         .where('holdExpiresAt', '<=', now)
//         .orderBy('holdExpiresAt')
//         .limit(batchSize);

//       let query = queryBase;
//       while (true) {
//         const snap = await query.get();
//         if (snap.empty) break;

//         lastSnapshotSize = snap.size;
//         const promises = snap.docs.map(async doc => {
//           const docRef = doc.ref;

//           try {
//             await db.runTransaction(async tx => {
//               const fresh = await tx.get(docRef);
//               if (!fresh.exists) return;
//               const data = fresh.data() || {};

//               // Skip if already released
//               if (data.holdReleased) return;

//               const holdExpiresAt = data.holdExpiresAt as
//                 | admin.firestore.Timestamp
//                 | undefined;
//               if (!holdExpiresAt) return;
//               if (holdExpiresAt.toMillis() > now.toMillis()) return; // not yet expired

//               // Collect reservations: multiple shapes supported
//               const reservations: Array<any> =
//                 data.holdCounterReservations ||
//                 data.holdCounterDocIds ||
//                 data.holdCounterDocs ||
//                 [];

//               // If reservations is an object map, transform to array
//               const reservationsArray = Array.isArray(reservations)
//                 ? reservations
//                 : Object.keys(reservations).map(k => reservations[k]);

//               // Release each reservation by incrementing the best numeric field
//               for (const r of reservationsArray) {
//                 // normalize to path + amount
//                 let counterPath: string | null = null;
//                 let amount = 1;

//                 if (typeof r === 'string') {
//                   counterPath = r;
//                 } else if (typeof r === 'object' && r !== null) {
//                   counterPath =
//                     r.counterDocPath ||
//                     r.counterPath ||
//                     r.docPath ||
//                     r.path ||
//                     r.doc ||
//                     null;
//                   amount =
//                     Number(r.amount || r.qty || r.count || r.reserved || 1) ||
//                     1;
//                 }

//                 if (!counterPath) continue;
//                 const counterRef = db.doc(counterPath);

//                 // Read counter doc and pick a numeric field to increment
//                 const counterSnap = await tx.get(counterRef);
//                 if (!counterSnap.exists) {
//                   // nothing to restore
//                   continue;
//                 }
//                 const counterData = counterSnap.data();
//                 const numericField = chooseNumericField(counterData);

//                 if (numericField) {
//                   const update: any = {};
//                   update[numericField] =
//                     admin.firestore.FieldValue.increment(amount);
//                   tx.update(counterRef, update);
//                 } else {
//                   // If no numeric field found, increment `available` by default
//                   tx.update(counterRef, {
//                     available: admin.firestore.FieldValue.increment(amount),
//                   });
//                 }
//               }

//               // Mark doc as released and clear hold metadata (preserve audit trail)
//               const updates: any = {
//                 holdReleased: true,
//                 holdReleasedAt: admin.firestore.FieldValue.serverTimestamp(),
//                 holdReleasedBy: 'system',
//               };
//               // remove hold fields if present
//               if (data.holdExpiresAt !== undefined)
//                 updates['holdExpiresAt'] = admin.firestore.FieldValue.delete();
//               if (data.holdCounterReservations !== undefined)
//                 updates['holdCounterReservations'] =
//                   admin.firestore.FieldValue.delete();
//               if (data.holdCounterDocIds !== undefined)
//                 updates['holdCounterDocIds'] =
//                   admin.firestore.FieldValue.delete();
//               if (data.holdCounterDocs !== undefined)
//                 updates['holdCounterDocs'] =
//                   admin.firestore.FieldValue.delete();

//               // Optionally move status when it was a pending hold
//               if (
//                 data.status === 'pending' ||
//                 data.status === 'on_hold' ||
//                 data.status === 'hold'
//               ) {
//                 // For orders, mark as 'expired' so UI can show expired state
//                 if (collectionPath === 'orders') {
//                   updates['status'] = 'expired';
//                   updates['expiredAt'] =
//                     admin.firestore.FieldValue.serverTimestamp();
//                   // Create mandatory notifications for both client and vendor
//                   try {
//                     const clientId = data.clientId || data.client || null;
//                     const vendorId = data.vendorId || data.vendor || null;
//                     const publicCode = data.publicCode || '';
//                     const clientName =
//                       (data.clientInfo && (data.clientInfo.name || '')) ||
//                       data.clientName ||
//                       '';

//                     // Notification payload common fields
//                     const notifBase: any = {
//                       orderId: docRef.id,
//                       publicCode: publicCode,
//                       clientName: clientName,
//                       expired: true,
//                       expiryReason: 'hold_expired',
//                       createdAt: admin.firestore.FieldValue.serverTimestamp(),
//                       timestamp: admin.firestore.FieldValue.serverTimestamp(),
//                       read: false,
//                     };

//                     // Avoid creating duplicate expiry notifications when a
//                     // more-specific release job (e.g. pickup hold release)
//                     // already marked the order with an expiration reason/hold.
//                     const alreadyMarked =
//                       data.expirationReason ||
//                       data.expiryReason ||
//                       data.holdType;
//                     if (!alreadyMarked) {
//                       try {
//                         // Double-check: if a specialized expiry notification was
//                         // already created for this order (slot/serving types),
//                         // skip creating the generic `orderExpired` to avoid duplicates.
//                         const specializedTypes = [
//                           'order_expired_serving',
//                           'order_expired_slot',
//                         ];
//                         const existing = await db
//                           .collection('notifications')
//                           .where('orderId', '==', docRef.id)
//                           .where('type', 'in', specializedTypes)
//                           .limit(1)
//                           .get();

//                         if (!existing.empty) {
//                           console.log(
//                             `Skipping generic orderExpired for ${docRef.path} because specialized notification already exists`,
//                           );
//                         } else {
//                           if (clientId) {
//                             const clientNotifRef = db
//                               .collection('notifications')
//                               .doc();
//                             tx.set(clientNotifRef, {
//                               userId: clientId,
//                               type: 'orderExpired',
//                               ...notifBase,
//                             });
//                           }

//                           if (vendorId) {
//                             const vendorNotifRef = db
//                               .collection('notifications')
//                               .doc();
//                             tx.set(vendorNotifRef, {
//                               userId: vendorId,
//                               type: 'orderExpired',
//                               vendorId: vendorId,
//                               ...notifBase,
//                             });
//                           }
//                         }
//                       } catch (err) {
//                         console.error(
//                           'Error checking existing expiry notifications:',
//                           err,
//                         );
//                       }
//                     } else {
//                       console.log(
//                         `Skipping generic orderExpired for ${docRef.path} because specialized expiration exists`,
//                       );
//                     }
//                   } catch (err) {
//                     console.error(
//                       'Failed to create expiry notifications:',
//                       err,
//                     );
//                   }
//                 } else {
//                   // For other collections (bookings) keep previous behaviour
//                   updates['status'] = 'cancelled';
//                   updates['cancellationReason'] = 'hold_expired';
//                 }
//               }

//               tx.update(docRef, updates);
//             });
//           } catch (err) {
//             console.error(
//               `Failed to release hold for ${collectionPath}/${doc.id}:`,
//               err,
//             );
//           }
//         });

//         await Promise.all(promises);

//         // Prepare next page: startAfter last doc
//         const last = snap.docs[snap.docs.length - 1];
//         query = queryBase.startAfter(last);
//         if (snap.size < batchSize) break;
//       }
//       return lastSnapshotSize;
//     }

//     // Run for both collections
//     try {
//       const ordersProcessed = await processCollection('orders');
//       const bookingsProcessed = await processCollection('bookings');
//       console.log(
//         `[releaseExpiredHolds] processed orders:${ordersProcessed} bookings:${bookingsProcessed}`,
//       );
//     } catch (err) {
//       console.error('[releaseExpiredHolds] unexpected error:', err);
//     }

//     return null;
//   });

// // ============================================
// // BOOKING SYSTEM CLOUD FUNCTIONS
// // ============================================

// // Notify vendor when a new booking is created
// export const notifyVendorOnNewBooking = functions.firestore
//   .document('bookings/{bookingId}')
//   .onCreate(async (snap, context) => {
//     const booking = snap.data();
//     if (!booking) return null;

//     const vendorId = booking.vendorId;
//     const clientName = booking.clientInfo?.name
//       ? `${booking.clientInfo.name} ${booking.clientInfo.lastName || ''}`.trim()
//       : 'Client';
//     const bookingId = context.params.bookingId;
//     const publicCode = booking.publicCode || bookingId.slice(-6).toUpperCase();
//     const serviceType = booking.serviceType || 'table booking';

//     if (!vendorId) {
//       console.log('No vendor ID found for booking');
//       return null;
//     }

//     // Check user preferences before creating notification
//     const shouldSend = await shouldSendNotification(vendorId, 'newBooking');
//     if (!shouldSend) {
//       console.log(
//         `Skipping new booking notification for vendor ${vendorId} - disabled in preferences`,
//       );
//       return null;
//     }

//     try {
//       // Use NotificationService function for proper formatting
//       await admin.firestore().collection('notifications').add({
//         userId: vendorId,
//         bookingId: bookingId,
//         publicCode: publicCode,
//         clientName: clientName,
//         serviceType: serviceType,
//         type: 'newBooking',
//         archived: false,
//         // Let client/localized UI render title/body from `type` + payload
//         message: '',
//         createdAt: new Date().toISOString(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       });

//       console.log(
//         `New booking notification created for vendor ${vendorId}, booking ${bookingId}`,
//       );
//     } catch (error) {
//       console.error('Error creating new booking notification:', error);
//     }

//     return null;
//   });

// // Notify client when booking status changes
// export const notifyClientOnBookingStatusChange = functions.firestore
//   .document('bookings/{bookingId}')
//   .onUpdate(async (change, context) => {
//     const before = change.before.data();
//     const after = change.after.data();

//     // Only proceed if status actually changed
//     if (before.status === after.status) {
//       return null;
//     }

//     const clientId = after.clientId;
//     const bookingId = context.params.bookingId;

//     if (!clientId) {
//       console.log('No client ID found for booking');
//       return null;
//     }

//     // Determine notification type based on new status
//     let notificationType = '';

//     switch (after.status) {
//       case 'accepted':
//         notificationType = 'bookingAccepted';
//         break;
//       case 'rejected':
//         notificationType = 'bookingRejected';
//         break;
//       case 'cancelled':
//         notificationType = 'bookingCancelled';
//         break;
//       case 'expired':
//         notificationType = 'bookingExpired';
//         break;
//       case 'completed':
//         notificationType = 'bookingCompleted';
//         break;
//       default:
//         console.log(
//           `No notification needed for booking status: ${after.status}`,
//         );
//         return null;
//     }

//     // Expiry notifications are mandatory and should not be filtered by preferences
//     let shouldProceed = true;
//     if (notificationType !== 'bookingExpired') {
//       const shouldSend = await shouldSendNotification(
//         clientId,
//         notificationType,
//       );
//       if (!shouldSend) {
//         console.log(
//           `Skipping ${notificationType} notification for client ${clientId} - disabled in preferences`,
//         );
//         shouldProceed = false;
//       }
//     }
//     if (!shouldProceed) return null;

//     try {
//       const publicCode = after.publicCode || bookingId.slice(-6).toUpperCase();
//       const date = after.date || '';
//       const mealTime = after.mealTime || '';

//       // Create notification data based on type
//       let notificationData: any = {
//         userId: clientId,
//         bookingId: bookingId,
//         publicCode: publicCode,
//         type: notificationType,
//         archived: false,
//         createdAt: new Date().toISOString(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       };

//       // Add type-specific data and message
//       switch (notificationType) {
//         case 'bookingAccepted':
//           notificationData.deliveryDate = date;
//           notificationData.mealTime = mealTime;
//           break;
//         case 'bookingRejected':
//           notificationData.rejectionReason =
//             after.rejectionReason || 'No reason provided';
//           notificationData.message = '';
//           break;
//         case 'bookingCancelled':
//           notificationData.cancellationReason =
//             after.cancellationReason || 'No reason provided';
//           break;
//         case 'bookingExpired':
//           // mandatory dynamic expiry payload (client and vendor will localize)
//           notificationData.expired = true;
//           notificationData.expiredAt =
//             admin.firestore.FieldValue.serverTimestamp();
//           notificationData.expiryReason = after.expiryReason || 'hold_expired';
//           break;
//         default:
//           notificationData.message = `Your booking ${publicCode} status changed to ${after.status}`;
//       }

//       // Create notification for client
//       await admin.firestore().collection('notifications').add(notificationData);

//       // Also create a mandatory vendor notification for expiry events
//       if (notificationType === 'bookingExpired') {
//         try {
//           const vendorId = after.vendorId || after.vendor || null;
//           if (vendorId) {
//             const vendorNotif: any = {
//               userId: vendorId,
//               type: 'bookingExpired',
//               bookingId: bookingId,
//               publicCode: publicCode,
//               clientName: after.clientInfo?.name || after.clientName || '',
//               expired: true,
//               expiredAt: admin.firestore.FieldValue.serverTimestamp(),
//               expiryReason: after.expiryReason || 'hold_expired',
//               createdAt: admin.firestore.FieldValue.serverTimestamp(),
//               timestamp: admin.firestore.FieldValue.serverTimestamp(),
//               read: false,
//             };
//             await admin
//               .firestore()
//               .collection('notifications')
//               .add(vendorNotif);
//           }
//         } catch (err) {
//           console.error(
//             'Failed to create vendor bookingExpired notification:',
//             err,
//           );
//         }
//       }

//       console.log(
//         `${notificationType} notification created for client ${clientId}, booking ${bookingId}`,
//       );
//     } catch (error) {
//       console.error(`Error creating ${notificationType} notification:`, error);
//     }

//     return null;
//   });

// // Notify client when their booking is cancelled due to order conflict
// export const notifyClientOnBookingCancellation = functions.firestore
//   .document('bookings/{bookingId}')
//   .onUpdate(async (change, context) => {
//     const before = change.before.data();
//     const after = change.after.data();

//     // Only proceed if booking was cancelled due to conflict
//     if (
//       before.status !== 'cancelled' &&
//       after.status === 'cancelled' &&
//       after.cancellationReason === 'order_conflict'
//     ) {
//       const clientId = after.clientId;
//       const bookingId = context.params.bookingId;

//       if (!clientId) return null;

//       // Check user preferences
//       const shouldSend = await shouldSendNotification(
//         clientId,
//         'bookingConflictCancellation',
//       );
//       if (!shouldSend) {
//         console.log(
//           `Skipping booking conflict notification for client ${clientId} - disabled in preferences`,
//         );
//         return null;
//       }

//       try {
//         await admin
//           .firestore()
//           .collection('notifications')
//           .add({
//             userId: clientId,
//             type: 'bookingConflictCancellation',
//             bookingId: bookingId,
//             bookingDate: after.date,
//             tableNumber: after.tableNumber,
//             vendorId: after.vendorId,
//             conflictOrderId: after.conflictOrderId || null,
//             createdAt: admin.firestore.FieldValue.serverTimestamp(),
//             timestamp: admin.firestore.FieldValue.serverTimestamp(),
//             read: false,
//           });

//         console.log(
//           `Booking conflict cancellation notification created for client ${clientId}`,
//         );
//       } catch (error) {
//         console.error('Error creating booking conflict notification:', error);
//       }
//     }

//     return null;
//   });

// // Update booking statistics when booking status changes
// export const updateBookingStatistics = functions.firestore
//   .document('bookings/{bookingId}')
//   .onWrite(async (change, context) => {
//     console.log('Booking statistics update triggered!');

//     const beforeData = change.before.exists ? change.before.data() : null;
//     const afterData = change.after.exists ? change.after.data() : null;

//     // Only process if status changed
//     const beforeStatus = beforeData?.status;
//     const afterStatus = afterData?.status;

//     if (beforeStatus === afterStatus) {
//       return null;
//     }

//     // Use vendorId from afterData if exists, else from beforeData (for deletions)
//     const vendorId = afterData ? afterData.vendorId : beforeData?.vendorId;
//     if (!vendorId) {
//       console.log('No vendor ID found for booking');
//       return null;
//     }

//     try {
//       const vendorRef = admin.firestore().collection('users').doc(vendorId);
//       const vendorDoc = await vendorRef.get();
//       const vendorData = vendorDoc.data();

//       if (!vendorData) {
//         console.log('Vendor not found');
//         return null;
//       }

//       // Initialize booking statistics if they don't exist
//       const bookingStats = vendorData.bookingStatistics || {
//         totalBookings: 0,
//         acceptedBookings: 0,
//         completedBookings: 0,
//         cancelledBookings: 0,
//         rejectedBookings: 0,
//         expiredBookings: 0,
//       };

//       // Handle booking deletion
//       if (!afterData) {
//         if (beforeStatus === 'accepted') {
//           bookingStats.acceptedBookings = Math.max(
//             0,
//             (bookingStats.acceptedBookings || 0) - 1,
//           );
//         }
//         if (beforeStatus === 'completed') {
//           bookingStats.completedBookings = Math.max(
//             0,
//             (bookingStats.completedBookings || 0) - 1,
//           );
//         }
//         if (beforeStatus === 'cancelled') {
//           bookingStats.cancelledBookings = Math.max(
//             0,
//             (bookingStats.cancelledBookings || 0) - 1,
//           );
//         }
//         if (beforeStatus === 'rejected') {
//           bookingStats.rejectedBookings = Math.max(
//             0,
//             (bookingStats.rejectedBookings || 0) - 1,
//           );
//         }
//         if (beforeStatus === 'expired') {
//           bookingStats.expiredBookings = Math.max(
//             0,
//             (bookingStats.expiredBookings || 0) - 1,
//           );
//         }
//         bookingStats.totalBookings = Math.max(
//           0,
//           (bookingStats.totalBookings || 0) - 1,
//         );

//         await vendorRef.update({
//           bookingStatistics: bookingStats,
//           lastBookingUpdate: admin.firestore.FieldValue.serverTimestamp(),
//         });
//         return null;
//       }

//       // Status transitions for new bookings
//       if (!beforeData) {
//         bookingStats.totalBookings = (bookingStats.totalBookings || 0) + 1;
//         if (afterStatus === 'expired') {
//           bookingStats.expiredBookings =
//             (bookingStats.expiredBookings || 0) + 1;
//         }
//       }

//       // Handle status changes
//       if (afterStatus === 'accepted' && beforeStatus !== 'accepted') {
//         bookingStats.acceptedBookings =
//           (bookingStats.acceptedBookings || 0) + 1;
//       }
//       if (afterStatus === 'completed' && beforeStatus !== 'completed') {
//         bookingStats.completedBookings =
//           (bookingStats.completedBookings || 0) + 1;
//       }
//       if (afterStatus === 'cancelled' && beforeStatus !== 'cancelled') {
//         bookingStats.cancelledBookings =
//           (bookingStats.cancelledBookings || 0) + 1;
//       }
//       if (afterStatus === 'rejected' && beforeStatus !== 'rejected') {
//         bookingStats.rejectedBookings =
//           (bookingStats.rejectedBookings || 0) + 1;
//       }
//       if (afterStatus === 'expired' && beforeStatus !== 'expired') {
//         bookingStats.expiredBookings = (bookingStats.expiredBookings || 0) + 1;
//       }

//       // Handle status reversions
//       if (beforeStatus === 'accepted' && afterStatus !== 'accepted') {
//         bookingStats.acceptedBookings = Math.max(
//           0,
//           (bookingStats.acceptedBookings || 0) - 1,
//         );
//       }
//       if (beforeStatus === 'completed' && afterStatus !== 'completed') {
//         bookingStats.completedBookings = Math.max(
//           0,
//           (bookingStats.completedBookings || 0) - 1,
//         );
//       }
//       if (beforeStatus === 'cancelled' && afterStatus !== 'cancelled') {
//         bookingStats.cancelledBookings = Math.max(
//           0,
//           (bookingStats.cancelledBookings || 0) - 1,
//         );
//       }
//       if (beforeStatus === 'rejected' && afterStatus !== 'rejected') {
//         bookingStats.rejectedBookings = Math.max(
//           0,
//           (bookingStats.rejectedBookings || 0) - 1,
//         );
//       }
//       if (beforeStatus === 'expired' && afterStatus !== 'expired') {
//         bookingStats.expiredBookings = Math.max(
//           0,
//           (bookingStats.expiredBookings || 0) - 1,
//         );
//       }

//       await vendorRef.update({
//         bookingStatistics: bookingStats,
//         lastBookingUpdate: admin.firestore.FieldValue.serverTimestamp(),
//       });

//       console.log(
//         `Updated vendor ${vendorId} booking statistics:`,
//         bookingStats,
//       );
//     } catch (error) {
//       console.error('Error updating booking statistics:', error);
//     }

//     return null;
//   });

// // Notify clients of upcoming bookings (runs daily at 8 AM)
// export const notifyClientsOfUpcomingBookings = functions.pubsub
//   .schedule('every day 08:00')
//   .timeZone('UTC')
//   .onRun(async _context => {
//     const db = admin.firestore();
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);
//     const tomorrow = new Date(today);
//     tomorrow.setDate(today.getDate() + 1);

//     // Query bookings for tomorrow with status accepted
//     const bookingsSnap = await db
//       .collection('bookings')
//       .where('date', '>=', today.toISOString())
//       .where('date', '<=', tomorrow.toISOString())
//       .where('status', '==', 'accepted')
//       .get();

//     if (bookingsSnap.empty) {
//       console.log('No upcoming bookings found.');
//       return null;
//     }

//     const notifications: any[] = [];

//     for (const doc of bookingsSnap.docs) {
//       const booking = doc.data();
//       const clientId = booking.clientId;
//       if (!clientId) continue;

//       // Check if a reminder notification already exists
//       const existing = await db
//         .collection('notifications')
//         .where('userId', '==', clientId)
//         .where('type', '==', 'bookingReminder')
//         .where('bookingId', '==', doc.id)
//         .get();
//       if (!existing.empty) continue;

//       // Check user preferences
//       const shouldSend = await shouldSendNotification(
//         clientId,
//         'bookingReminder',
//       );
//       if (!shouldSend) continue;

//       notifications.push({
//         userId: clientId,
//         type: 'bookingReminder',
//         bookingId: doc.id,
//         bookingDate: booking.date,
//         tableNumber: booking.tableNumber,
//         numberOfGuests: booking.numberOfGuests,
//         vendorId: booking.vendorId,
//         createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       });
//     }

//     // Batch create notifications
//     if (notifications.length > 0) {
//       const batch = db.batch();
//       notifications.forEach(notif => {
//         const ref = db.collection('notifications').doc();
//         batch.set(ref, notif);
//       });
//       await batch.commit();
//       console.log(
//         `Created ${notifications.length} booking reminder notifications.`,
//       );
//     }

//     return null;
//   });

// // Notify vendors of upcoming bookings (runs daily at 8 AM)
// export const notifyVendorsOfUpcomingBookings = functions.pubsub
//   .schedule('every day 08:00')
//   .timeZone('UTC')
//   .onRun(async _context => {
//     const db = admin.firestore();
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);
//     const tomorrow = new Date(today);
//     tomorrow.setDate(today.getDate() + 1);

//     // Query bookings for tomorrow with status accepted
//     const bookingsSnap = await db
//       .collection('bookings')
//       .where('date', '>=', today.toISOString())
//       .where('date', '<=', tomorrow.toISOString())
//       .where('status', '==', 'accepted')
//       .get();

//     if (bookingsSnap.empty) {
//       console.log('No upcoming vendor bookings found.');
//       return null;
//     }

//     // Group bookings by vendor
//     const vendorBookings: {[vendorId: string]: any[]} = {};

//     bookingsSnap.docs.forEach(doc => {
//       const booking = doc.data();
//       const vendorId = booking.vendorId;
//       if (vendorId) {
//         if (!vendorBookings[vendorId]) {
//           vendorBookings[vendorId] = [];
//         }
//         vendorBookings[vendorId].push({id: doc.id, ...booking});
//       }
//     });

//     const notifications: any[] = [];

//     for (const [vendorId, bookings] of Object.entries(vendorBookings)) {
//       // Check if a reminder notification already exists for this vendor today
//       const existing = await db
//         .collection('notifications')
//         .where('userId', '==', vendorId)
//         .where('type', '==', 'vendorBookingReminder')
//         .where('timestamp', '>=', today)
//         .get();
//       if (!existing.empty) continue;

//       // Check user preferences
//       const shouldSend = await shouldSendNotification(
//         vendorId,
//         'vendorBookingReminder',
//       );
//       if (!shouldSend) continue;

//       notifications.push({
//         userId: vendorId,
//         type: 'vendorBookingReminder',
//         bookingCount: bookings.length,
//         bookingIds: bookings.map(b => b.id),
//         bookingDate: bookings[0].date,
//         createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       });
//     }

//     // Batch create notifications
//     if (notifications.length > 0) {
//       const batch = db.batch();
//       notifications.forEach(notif => {
//         const ref = db.collection('notifications').doc();
//         batch.set(ref, notif);
//       });
//       await batch.commit();
//       console.log(
//         `Created ${notifications.length} vendor booking reminder notifications.`,
//       );
//     }

//     return null;
//   });

// // Auto-complete bookings that have passed their date (runs daily at midnight)
// export const autoCompleteExpiredBookings = functions.pubsub
//   .schedule('0 0 * * *')
//   .timeZone('UTC')
//   .onRun(async _context => {
//     console.log('Auto-completing expired bookings...');

//     const db = admin.firestore();
//     const now = new Date();
//     const yesterday = new Date(now);
//     yesterday.setDate(now.getDate() - 1);
//     yesterday.setHours(23, 59, 59, 999);

//     try {
//       // Find accepted bookings that are past their date
//       const expiredBookingsQuery = db
//         .collection('bookings')
//         .where('status', '==', 'accepted')
//         .where('date', '<=', yesterday.toISOString())
//         .limit(500); // Process in batches

//       const snapshot = await expiredBookingsQuery.get();

//       if (snapshot.empty) {
//         console.log('No expired bookings to complete');
//         return;
//       }

//       const batch = db.batch();
//       let count = 0;

//       snapshot.forEach(doc => {
//         batch.update(doc.ref, {
//           status: 'completed',
//           completedAt: admin.firestore.FieldValue.serverTimestamp(),
//           completedReason: 'auto_completed_expired',
//         });
//         count++;
//       });

//       await batch.commit();
//       console.log(`Auto-completed ${count} expired bookings`);

//       // Create notifications for clients to review their completed bookings
//       const reviewNotifications: any[] = [];
//       for (const doc of snapshot.docs) {
//         const booking = doc.data();
//         const clientId = booking.clientId;
//         const vendorId = booking.vendorId;

//         if (clientId && vendorId) {
//           // Check user preferences
//           const shouldSend = await shouldSendNotification(
//             clientId,
//             'request_booking_review',
//           );
//           if (shouldSend) {
//             reviewNotifications.push({
//               userId: clientId,
//               type: 'request_booking_review',
//               bookingId: doc.id,
//               vendorId: vendorId,
//               createdAt: admin.firestore.FieldValue.serverTimestamp(),
//               timestamp: admin.firestore.FieldValue.serverTimestamp(),
//               read: false,
//             });
//           }
//         }
//       }

//       // Batch create review notifications
//       if (reviewNotifications.length > 0) {
//         const reviewBatch = db.batch();
//         reviewNotifications.forEach(notif => {
//           const ref = db.collection('notifications').doc();
//           reviewBatch.set(ref, notif);
//         });
//         await reviewBatch.commit();
//         console.log(
//           `Created ${reviewNotifications.length} booking review notifications`,
//         );
//       }
//     } catch (error) {
//       console.error('Error auto-completing expired bookings:', error);
//     }

//     return null;
//   });

// // Clean up old completed bookings (runs weekly on Sundays at 3 AM)
// export const cleanupOldBookings = functions.pubsub
//   .schedule('0 3 * * 0')
//   .timeZone('UTC')
//   .onRun(async _context => {
//     console.log('Cleaning up old bookings...');

//     const db = admin.firestore();
//     const sixtyDaysAgo = new Date();
//     sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

//     try {
//       const oldBookingsQuery = db
//         .collection('bookings')
//         .where('status', 'in', ['completed', 'cancelled', 'rejected'])
//         .where('date', '<', sixtyDaysAgo.toISOString())
//         .limit(500); // Process in batches

//       const snapshot = await oldBookingsQuery.get();

//       if (snapshot.empty) {
//         console.log('No old bookings to clean up');
//         return;
//       }

//       const batch = db.batch();
//       let count = 0;

//       snapshot.forEach(doc => {
//         batch.delete(doc.ref);
//         count++;
//       });

//       await batch.commit();
//       console.log(`Deleted ${count} old bookings`);
//     } catch (error) {
//       console.error('Error cleaning up old bookings:', error);
//     }

//     return null;
//   });

// // Notify client to review booking after completion
// export const notifyClientToReviewBooking = functions.firestore
//   .document('bookings/{bookingId}')
//   .onUpdate(async (change, context) => {
//     const before = change.before.data();
//     const after = change.after.data();

//     // Only proceed if status changed to 'completed'
//     if (before.status === after.status || after.status !== 'completed') {
//       return null;
//     }

//     // Get clientId and vendorId
//     const clientId = after.clientId;
//     const vendorId = after.vendorId;
//     if (!clientId || !vendorId) return null;

//     // Check user preferences
//     const shouldSend = await shouldSendNotification(
//       clientId,
//       'request_booking_review',
//     );
//     if (!shouldSend) {
//       console.log(
//         `Skipping request_booking_review notification for client ${clientId} - disabled in preferences`,
//       );
//       return null;
//     }

//     // Create a notification for the client to review the booking
//     await admin.firestore().collection('notifications').add({
//       userId: clientId,
//       type: 'request_booking_review',
//       vendorId: vendorId,
//       bookingId: context.params.bookingId,
//       bookingDate: after.date,
//       tableNumber: after.tableNumber,
//       createdAt: admin.firestore.FieldValue.serverTimestamp(),
//       timestamp: admin.firestore.FieldValue.serverTimestamp(),
//       read: false,
//     });

//     console.log(`Created booking review request for client ${clientId}`);
//     return null;
//   });

// // Update notification preferences to include booking-related notifications
// export const updateNotificationPreferencesForBookings = functions.https.onCall(
//   async (data, context) => {
//     if (!context.auth) {
//       throw new functions.https.HttpsError(
//         'unauthenticated',
//         'User must be authenticated',
//       );
//     }

//     const userId = context.auth.uid;
//     const {bookingNotifications = true} = data;

//     try {
//       await admin.firestore().collection('users').doc(userId).update({
//         'notificationPreferences.newBooking': bookingNotifications,
//         'notificationPreferences.bookingAccepted': bookingNotifications,
//         'notificationPreferences.bookingRejected': bookingNotifications,
//         'notificationPreferences.bookingCancelled': bookingNotifications,
//         'notificationPreferences.bookingCompleted': bookingNotifications,
//         'notificationPreferences.bookingReminder': bookingNotifications,
//         'notificationPreferences.vendorBookingReminder': bookingNotifications,
//         'notificationPreferences.bookingConflictCancellation':
//           bookingNotifications,
//         'notificationPreferences.request_booking_review': bookingNotifications,
//       });

//       return {success: true};
//     } catch (error) {
//       console.error('Error updating booking notification preferences:', error);
//       throw new functions.https.HttpsError(
//         'internal',
//         'Failed to update notification preferences',
//       );
//     }
//   },
// );

// // Release expired pickup slot holds and cancel pending orders
// export const releaseExpiredPickupHolds = functions.pubsub
//   .schedule('every 1 minutes')
//   .timeZone('UTC')
//   .onRun(async () => {
//     try {
//       const nowTs = admin.firestore.Timestamp.now();
//       console.log(
//         `🔄 Checking for expired pickup holds at ${nowTs
//           .toDate()
//           .toISOString()}`,
//       );

//       // Find expired holds (compare Timestamps)
//       const expiredHoldsQuery = await admin
//         .firestore()
//         .collection('pickupSlotHolds')
//         .where('status', '==', 'active')
//         .where('holdExpiresAt', '<=', nowTs)
//         .get();

//       if (expiredHoldsQuery.empty) {
//         console.log('✅ No expired pickup holds found');
//         return null;
//       }

//       console.log(`🔍 Found ${expiredHoldsQuery.size} expired pickup holds`);

//       const batch = admin.firestore().batch();
//       let releasedCount = 0;
//       let expiredOrdersCount = 0;

//       for (const holdDoc of expiredHoldsQuery.docs) {
//         const hold = holdDoc.data();

//         // Mark hold as expired
//         batch.update(holdDoc.ref, {
//           status: 'expired',
//           expiredAt: admin.firestore.FieldValue.serverTimestamp(),
//         });

//         // Find and cancel pending orders that were holding this slot or serving
//         let pendingOrdersQuery: FirebaseFirestore.QuerySnapshot | null = null;

//         if (hold.slotTime) {
//           // slot-based holds: match by pickupTimeSlot + date
//           pendingOrdersQuery = await admin
//             .firestore()
//             .collection('orders')
//             .where('status', '==', 'pending')
//             .where('deliveryMethod', '==', 'pickup')
//             .where('pickupTimeSlot', '==', hold.slotTime)
//             .where('selectedDate', '==', hold.date)
//             .get();
//         } else {
//           // serving-based holds: match pending pickup orders on the date
//           // optionally filter by mealTime if present on the hold
//           // For serving-based holds we must consider orders regardless of deliveryMethod
//           // (servings apply across pickup and delivery). Do not filter by deliveryMethod here.
//           let q: FirebaseFirestore.Query = admin
//             .firestore()
//             .collection('orders')
//             .where('status', '==', 'pending')
//             .where('selectedDate', '==', hold.date);

//           if (hold.mealTime) {
//             q = q.where('selectedMealTime', '==', hold.mealTime);
//           }

//           pendingOrdersQuery = await q.get();
//         }

//         // Cancel the pending orders (if any)
//         if (pendingOrdersQuery && !pendingOrdersQuery.empty) {
//           for (const orderDoc of pendingOrdersQuery.docs) {
//             const order = orderDoc.data();

//             // Check if this order contains the food item from the hold
//             const hasMatchingItem = order.items?.some(
//               (item: any) =>
//                 item.itemId === hold.foodItemId ||
//                 item.foodItemId === hold.foodItemId,
//             );

//             if (hasMatchingItem) {
//               batch.update(orderDoc.ref, {
//                 status: 'expired',
//                 // Use a code-style expiration reason so clients can localize
//                 expirationReason: hold.slotTime
//                   ? 'slot_hold_expired'
//                   : 'serving_hold_expired',
//                 // Also write preferred `expiryReason` for consistency with notifications
//                 expiryReason: hold.slotTime
//                   ? 'slot_hold_expired'
//                   : 'serving_hold_expired',
//                 expiredAt: admin.firestore.FieldValue.serverTimestamp(),
//                 updatedAt: admin.firestore.FieldValue.serverTimestamp(),
//               });
//               expiredOrdersCount++;
//               // Client notification for expired orders is handled by the
//               // central expiry flow elsewhere; do not create a duplicate
//               // hold-specific notification here.

//               // Create a vendor-facing notification so vendors are informed
//               // when an order they were holding expires.
//               try {
//                 if (order.vendorId) {
//                   const vendorNotifRef = admin
//                     .firestore()
//                     .collection('notifications')
//                     .doc();
//                   batch.set(vendorNotifRef, {
//                     userId: order.vendorId,
//                     vendorId: order.vendorId,
//                     orderId: orderDoc.id,
//                     publicCode: order.publicCode || '',
//                     type: 'orderExpired',
//                     expired: true,
//                     expiryReason: hold.slotTime
//                       ? 'slot_hold_expired'
//                       : 'serving_hold_expired',
//                     expiredAt: admin.firestore.FieldValue.serverTimestamp(),
//                     message: '',
//                     createdAt: admin.firestore.FieldValue.serverTimestamp(),
//                     timestamp: admin.firestore.FieldValue.serverTimestamp(),
//                     read: false,
//                     role: 'vendor',
//                   });
//                 }
//               } catch (err) {
//                 // Keep hold release best-effort; log and continue
//                 console.error('Error queuing vendor expiry notification:', err);
//               }
//             }
//           }
//         }

//         releasedCount++;
//       }

//       // Commit all changes
//       await batch.commit();

//       console.log(
//         `✅ Released ${releasedCount} expired pickup holds and expired ${expiredOrdersCount} orders`,
//       );

//       return {
//         releasedHolds: releasedCount,
//         expiredOrders: expiredOrdersCount,
//         timestamp: nowTs.toDate().toISOString(),
//       };
//     } catch (error) {
//       console.error('❌ Error in releaseExpiredPickupHolds:', error);
//       throw error;
//     }
//   });

// // Release expired booking holds and expire related pending bookings
// export const releaseExpiredBookingHolds = functions.pubsub
//   .schedule('every 1 minutes')
//   .timeZone('UTC')
//   .onRun(async () => {
//     const db = admin.firestore();
//     const now = admin.firestore.Timestamp.now();

//     try {
//       console.log(
//         `🔄 Checking for expired booking holds at ${now
//           .toDate()
//           .toISOString()}`,
//       );

//       // Find expired booking holds (compare Timestamps)
//       const expiredHoldsQuery = await db
//         .collection('bookingHolds')
//         .where('status', '==', 'active')
//         .where('holdExpiresAt', '<=', now)
//         .get();

//       if (expiredHoldsQuery.empty) {
//         console.log('✅ No expired booking holds found');
//         return null;
//       }

//       console.log(`🔍 Found ${expiredHoldsQuery.size} expired booking holds`);

//       const batch = db.batch();
//       let releasedCount = 0;
//       let expiredBookingsCount = 0;

//       for (const holdDoc of expiredHoldsQuery.docs) {
//         const hold = holdDoc.data();

//         // Mark hold as released
//         batch.update(holdDoc.ref, {
//           status: 'released',
//           releasedAt: admin.firestore.FieldValue.serverTimestamp(),
//         });

//         // If hold directly references a bookingId, expire that booking when still pending
//         const bookingId = hold?.bookingId;
//         if (bookingId) {
//           const bookingRef = db.collection('bookings').doc(bookingId);
//           const bookingSnap = await bookingRef.get();
//           if (bookingSnap.exists) {
//             const booking = bookingSnap.data();
//             if (booking && booking.status === 'pending') {
//               batch.update(bookingRef, {
//                 status: 'expired',
//                 expiredAt: admin.firestore.FieldValue.serverTimestamp(),
//                 updatedAt: admin.firestore.FieldValue.serverTimestamp(),
//                 cancellationReason: 'booking_hold_expired',
//               });
//               expiredBookingsCount++;

//               // Notify client about expiration
//               if (booking.clientId) {
//                 const notifRef = db.collection('notifications').doc();
//                 batch.set(notifRef, {
//                   userId: booking.clientId,
//                   type: 'bookingExpired',
//                   bookingId: bookingId,
//                   publicCode: booking.publicCode || '',
//                   clientName:
//                     booking.clientInfo?.name || booking.clientName || '',
//                   expired: true,
//                   expiryReason: 'booking_hold_expired',
//                   expiredAt: admin.firestore.FieldValue.serverTimestamp(),
//                   message: '',
//                   createdAt: admin.firestore.FieldValue.serverTimestamp(),
//                   timestamp: admin.firestore.FieldValue.serverTimestamp(),
//                   read: false,
//                 });
//               }
//             }
//           }
//         } else {
//           // Fallback: find bookings that reference this hold via bookingHoldId
//           const q = await db
//             .collection('bookings')
//             .where('bookingHoldId', '==', holdDoc.id)
//             .get();
//           if (!q.empty) {
//             for (const bdoc of q.docs) {
//               const booking = bdoc.data();
//               if (booking && booking.status === 'pending') {
//                 batch.update(bdoc.ref, {
//                   status: 'expired',
//                   expiredAt: admin.firestore.FieldValue.serverTimestamp(),
//                   updatedAt: admin.firestore.FieldValue.serverTimestamp(),
//                   cancellationReason: 'booking_hold_expired',
//                 });
//                 expiredBookingsCount++;

//                 if (booking.clientId) {
//                   const notifRef = db.collection('notifications').doc();
//                   batch.set(notifRef, {
//                     userId: booking.clientId,
//                     type: 'bookingExpired',
//                     bookingId: bdoc.id,
//                     publicCode: booking.publicCode || '',
//                     clientName:
//                       booking.clientInfo?.name || booking.clientName || '',
//                     expired: true,
//                     expiryReason: 'booking_hold_expired',
//                     expiredAt: admin.firestore.FieldValue.serverTimestamp(),
//                     message: '',
//                     createdAt: admin.firestore.FieldValue.serverTimestamp(),
//                     timestamp: admin.firestore.FieldValue.serverTimestamp(),
//                     read: false,
//                   });
//                 }
//               }
//             }
//           }
//         }

//         releasedCount++;
//       }

//       // Commit batched updates
//       await batch.commit();

//       console.log(
//         `✅ Released ${releasedCount} booking holds and expired ${expiredBookingsCount} bookings`,
//       );

//       return {
//         releasedHolds: releasedCount,
//         expiredBookings: expiredBookingsCount,
//         timestamp: now.toDate().toISOString(),
//       };
//     } catch (error) {
//       console.error('❌ Error in releaseExpiredBookingHolds:', error);
//       throw error;
//     }
//   });

















//version 2
// import * as functions from 'firebase-functions/v1';
// import * as admin from 'firebase-admin';
// import {defineSecret} from 'firebase-functions/params';
// const nodemailer = require('nodemailer');

// const GMAIL_EMAIL = defineSecret('GMAIL_EMAIL');
// const GMAIL_PASSWORD = defineSecret('GMAIL_PASSWORD');

// admin.initializeApp();

// async function shouldSendNotification(
//   userId: string,
//   notificationType: string | number,
// ) {
//   try {
//     // ✅ MANDATORY NOTIFICATIONS - Always send these
//     const mandatoryNotifications = [
//       'orderAccepted',
//       'orderRejected',
//       'orderDelivered',
//       'orderExpired',
//       'newOrder',
//       'referral',
//       'referral_pending',
//       // Booking mandatory notifications
//       'newBooking',
//       'bookingAccepted',
//       'bookingRejected',
//       'bookingCancelled',
//       'bookingExpired',
//       'bookingConflictCancellation',
//     ];

//     // Always send mandatory notifications
//     if (mandatoryNotifications.includes(notificationType as string)) {
//       console.log(`Sending mandatory notification: ${notificationType}`);
//       return true;
//     }

//     // For optional notifications, check user preferences
//     const userDoc = await admin
//       .firestore()
//       .collection('users')
//       .doc(userId)
//       .get();
//     const preferences = userDoc.data()?.notificationPreferences;

//     if (!preferences) return true; // Default to send if no preferences

//     // Check global push notifications setting
//     if (!preferences.pushNotifications) return false;

//     // ✅ Map notification types to preference keys
//     const typeMapping: {[key: string]: string} = {
//       request_vendor_review: 'requestVendorReview',
//       new_review: 'newReview',
//       review_update: 'reviewUpdate',
//       review_deleted: 'reviewDeleted',
//       vendor_response: 'vendorResponse',
//       chat_message: 'chatMessage',
//       // ✅ Add these missing mappings
//       chatMessage: 'chatMessage',
//       requestVendorReview: 'requestVendorReview',
//       // ✅ Booking notification mappings
//       bookingCompleted: 'bookingCompleted',
//       bookingReminder: 'bookingReminder',
//       vendorBookingReminder: 'vendorBookingReminder',
//       request_booking_review: 'requestBookingReview',
//     };

//     // Get the preference key to check
//     const preferenceKey =
//       typeMapping[notificationType as string] || notificationType;

//     // Check specific notification type
//     return preferences[preferenceKey] !== false;
//   } catch (error) {
//     console.error('Error checking notification preferences:', error);
//     return true; // Default to send on error
//   }
// }

// // Centralized push sender that computes unread badge and cleans invalid tokens
// async function sendPushWithBadge(
//   userId: string,
//   basePayload: Partial<admin.messaging.Message>,
// ) {
//   try {
//     const userRef = admin.firestore().collection('users').doc(userId);
//     const userDoc = await userRef.get();
//     if (!userDoc.exists) return null;

//     // Support both fcmToken (string) and fcmTokens (array)
//     const rawTokens = userDoc.get('fcmTokens') || userDoc.get('fcmToken') || [];
//     let tokens: string[] = [];
//     if (Array.isArray(rawTokens)) tokens = rawTokens.filter(Boolean);
//     else if (typeof rawTokens === 'string' && rawTokens) tokens = [rawTokens];
//     if (!tokens.length) return null;

//     // Log tokens and environment to help debug routing/proxy issues
//     // tokens and environment information intentionally not logged in production

//     // Compute unread count excluding chat messages (match client-side behavior)
//     const unreadSnap = await admin
//       .firestore()
//       .collection('notifications')
//       .where('userId', '==', userId)
//       .where('read', '==', false)
//       .get();
//     const unreadCount = unreadSnap.docs.filter(
//       d => d.data()?.type !== 'chat_message',
//     ).length;

//     // Debug: log the computed unread count so we can verify the APNs badge value
//     // computed unreadCount is used to set the APNs badge

//     // Build apns payload with computed badge (preserve other aps fields if provided)
//     const apnsFromBase =
//       basePayload.apns && (basePayload.apns as any).payload
//         ? JSON.parse(JSON.stringify((basePayload.apns as any).payload))
//         : {aps: {}};
//     apnsFromBase.aps = apnsFromBase.aps || {};
//     apnsFromBase.aps.badge = unreadCount;
//     // Debug: log final APNs payload so we can confirm the exact `aps` sent
//     // final APNs payload prepared (not logged in production)
//     // Ensure sound/alert stay if provided in basePayload
//     const apns = {payload: apnsFromBase} as any;

//     // Compose multicast message
//     const multicast: admin.messaging.MulticastMessage = {
//       tokens,
//       notification: basePayload.notification,
//       data: basePayload.data,
//       android: basePayload.android,
//       apns,
//     };

//     let response: any = null;
//     try {
//       response = await admin.messaging().sendMulticast(multicast);
//     } catch (sendErr: any) {
//       // Multicast failed; fall back to sending to each token individually
//       const perResults: Array<{success: boolean; error?: any; token: string}> =
//         [];
//       for (const t of tokens) {
//         try {
//           const singleMsg: admin.messaging.Message = {
//             notification: basePayload.notification,
//             data: basePayload.data,
//             android: basePayload.android,
//             apns,
//             token: t,
//           } as any;
//           const sentId = await admin.messaging().send(singleMsg);
//           perResults.push({success: true, token: t, messageId: sentId} as any);
//         } catch (e) {
//           perResults.push({success: false, error: e, token: t});
//         }
//       }

//       response = {
//         responses: perResults.map(r => ({success: r.success, error: r.error})),
//         successCount: perResults.filter(r => r.success).length,
//         failureCount: perResults.filter(r => !r.success).length,
//       };
//     }

//     // Cleanup invalid tokens (do not log details in production)
//     const invalidTokens: string[] = [];
//     if (response && Array.isArray(response.responses)) {
//       response.responses.forEach((resp: any, idx: number) => {
//         if (!resp.success) {
//           const err = resp.error;
//           const code = (
//             (err && ((err as any).code || (err as any).message)) ||
//             ''
//           )
//             .toString()
//             .toLowerCase();
//           const patterns = [
//             'registration-token-not-registered',
//             'invalid-registration-token',
//             'not-registered',
//             'messaging/registration-token-not-registered',
//             'messaging/invalid-registration-token',
//           ];
//           if (patterns.some((p: string) => code.includes(p)))
//             invalidTokens.push(tokens[idx]);
//         }
//       });
//     }

//     if (invalidTokens.length) {
//       try {
//         if (Array.isArray(rawTokens)) {
//           const newTokens = tokens.filter(t => !invalidTokens.includes(t));
//           await userRef.update({fcmTokens: newTokens});
//         } else {
//           const single = rawTokens as string;
//           if (invalidTokens.includes(single)) {
//             await userRef.update({fcmToken: ''});
//           }
//         }
//       } catch (e) {
//         // failed to cleanup invalid tokens (not logged)
//       }
//     }

//     return response;
//   } catch (error) {
//     return null;
//   }
// }

// // Notify inviter of registration, but do NOT give credits yet
// export const notifyInviterOnRegistration = functions.firestore
//   .document('users/{userId}')
//   .onCreate(async (snap, context) => {
//     const newUser = snap.data();
//     const invitedBy = (newUser.invitedBy || '').trim().toUpperCase();
//     if (!invitedBy) return null;

//     // Find the inviter by referralCode
//     const inviterQuery = await admin
//       .firestore()
//       .collection('users')
//       .where('referralCode', '==', invitedBy)
//       .limit(1)
//       .get();

//     if (inviterQuery.empty) {
//       console.log(`No inviter found with referralCode: ${invitedBy}`);
//       return null;
//     }

//     const inviterDoc = inviterQuery.docs[0];
//     const inviterId = inviterDoc.id;

//     // Compose full name for notification
//     const fullName = [newUser.name, newUser.lastName].filter(Boolean).join(' ');

//     // Create notification document (no message, just data for translation)
//     await admin
//       .firestore()
//       .collection('notifications')
//       .add({
//         userId: inviterId,
//         type: 'referral_pending',
//         invitedPerson: fullName,
//         role: newUser.role || 'client',
//         createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       });

//     // Send push notification if inviter has an FCM token
//     // Send push notification via centralized helper (if any token exists)
//     try {
//       await sendPushWithBadge(inviterId, {
//         notification: {title: 'Referral Update', body: ''},
//         data: {
//           type: 'referral_pending',
//           invitedPerson: fullName,
//           role: newUser.role,
//         },
//       });
//       console.log(`Attempted push notification to inviter ${inviterId}`);
//     } catch (err) {
//       console.error('Error sending push via helper:', err);
//     }

//     console.log(
//       `Notified inviter ${inviterId} about registration of user ${context.params.userId}`,
//     );
//     return null;
//   });

// export const rewardInviterOnFirstOrder = functions.firestore
//   .document('orders/{orderId}')
//   .onUpdate(async (change, context) => {
//     const before = change.before.data();
//     const after = change.after.data();

//     // Only proceed if status changed to 'delivered'
//     if (before.status === after.status || after.status !== 'delivered') {
//       return null;
//     }

//     const clientId = after.clientId;
//     if (!clientId) return null;

//     // Get client user document
//     const clientRef = admin.firestore().collection('users').doc(clientId);
//     const clientDoc = await clientRef.get();
//     const clientData = clientDoc.data();

//     // Check if client was invited and hasn't triggered referral reward
//     if (!clientData?.invitedBy || clientData?.referralRewarded) {
//       return null;
//     }

//     // Check if this is the client's first delivered order
//     const deliveredOrdersSnap = await admin
//       .firestore()
//       .collection('orders')
//       .where('clientId', '==', clientId)
//       .where('status', '==', 'delivered')
//       .get();

//     if (deliveredOrdersSnap.size > 1) {
//       // Not the first delivered order
//       return null;
//     }

//     // Find the inviter by referralCode
//     const inviterQuery = await admin
//       .firestore()
//       .collection('users')
//       .where('referralCode', '==', clientData.invitedBy)
//       .limit(1)
//       .get();

//     if (inviterQuery.empty) {
//       console.log(
//         `No inviter found with referralCode: ${clientData.invitedBy}`,
//       );
//       return null;
//     }

//     const inviterDoc = inviterQuery.docs[0];
//     const inviterRef = inviterDoc.ref;
//     const inviterId = inviterDoc.id;

//     // Allocate credits (e.g., 5)
//     const creditsToAdd = 5;
//     await inviterRef.update({
//       credits: admin.firestore.FieldValue.increment(creditsToAdd),
//     });

//     // Compose full name for notification
//     const fullName = [clientData.name, clientData.lastName]
//       .filter(Boolean)
//       .join(' ');

//     // Create notification document (no message, just data for translation)
//     await admin.firestore().collection('notifications').add({
//       userId: inviterId,
//       type: 'referral',
//       creditsEarned: creditsToAdd,
//       invitedPerson: fullName,
//       createdAt: admin.firestore.FieldValue.serverTimestamp(),
//       timestamp: admin.firestore.FieldValue.serverTimestamp(),
//       read: false,
//     });

//     // Mark client as rewarded
//     await clientRef.update({referralRewarded: true});

//     // Optionally, send push notification (let app translate)
//     try {
//       await sendPushWithBadge(inviterId, {
//         notification: {title: 'Referral Bonus!', body: ''},
//         data: {
//           type: 'referral',
//           creditsEarned: String(creditsToAdd),
//           invitedPerson: fullName,
//         },
//       });
//       console.log(`Attempted push notification to inviter ${inviterId}`);
//     } catch (err) {
//       console.error('Error sending push via helper:', err);
//     }

//     console.log(
//       `Allocated ${creditsToAdd} credits to inviter ${inviterId} for client ${clientId}'s first delivered order`,
//     );
//     return null;
//   });

// export const incrementReviewsCountOnReviewCreate = functions.firestore
//   .document('reviews/{reviewId}')
//   .onCreate(async (snap, context) => {
//     const review = snap.data();
//     const batch = admin.firestore().batch();

//     // Only increment vendor's reviewsCount if this is a vendor review (no foodItemId)
//     if (review.vendorId && !review.foodItemId) {
//       const vendorRef = admin
//         .firestore()
//         .collection('users')
//         .doc(review.vendorId);
//       batch.update(vendorRef, {
//         reviewsCount: admin.firestore.FieldValue.increment(1),
//       });
//     }

//     // Only increment food item's reviewsCount if this is a food review
//     if (review.foodItemId) {
//       const foodItemRef = admin
//         .firestore()
//         .collection('foodItems')
//         .doc(review.foodItemId);
//       batch.update(foodItemRef, {
//         reviewsCount: admin.firestore.FieldValue.increment(1),
//       });
//     }

//     await batch.commit();

//     // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
//     const shouldSend = await shouldSendNotification(
//       review.vendorId,
//       'newReview',
//     );
//     if (!shouldSend) {
//       console.log(
//         `Skipping new_review notification for vendor ${review.vendorId} - disabled in preferences`,
//       );
//       return null;
//     }

//     // Fetch the order's or booking's publicCode using orderId or bookingId from the review
//     let publicCode = null;
//     if (review.orderId) {
//       const orderSnap = await admin
//         .firestore()
//         .collection('orders')
//         .doc(review.orderId)
//         .get();
//       if (orderSnap.exists) {
//         publicCode = orderSnap.get('publicCode') || null;
//       }
//     }
//     // If there's no order publicCode, try booking
//     if (!publicCode && review.bookingId) {
//       const bookingSnap = await admin
//         .firestore()
//         .collection('bookings')
//         .doc(review.bookingId)
//         .get();
//       if (bookingSnap.exists) {
//         publicCode = bookingSnap.get('publicCode') || null;
//       }
//     }

//     // Create a notification for the vendor (translatable in app)
//     await admin
//       .firestore()
//       .collection('notifications')
//       .add({
//         userId: review.vendorId,
//         type: 'new_review',
//         reviewId: context.params.reviewId,
//         foodItemId: review.foodItemId || null,
//         clientName: review.clientName || null,
//         hideClientName: review.hideClientName || false,
//         publicCode: publicCode,
//         orderId: review.orderId || null,
//         bookingId: review.bookingId || null,
//         createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       });

//     return null;
//   });

// export const notifyVendorOnReviewUpdate = functions.firestore
//   .document('reviews/{reviewId}')
//   .onUpdate(async (change, context) => {
//     const before = change.before.data();
//     const after = change.after.data();

//     // Only notify if the comment, photos, videos, or hideClientName changed
//     if (
//       before.comment === after.comment &&
//       JSON.stringify(before.photos) === JSON.stringify(after.photos) &&
//       JSON.stringify(before.videos) === JSON.stringify(after.videos) &&
//       before.hideClientName === after.hideClientName
//     ) {
//       return null; // No relevant change
//     }

//     // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
//     const shouldSend = await shouldSendNotification(
//       after.vendorId,
//       'reviewUpdate',
//     );
//     if (!shouldSend) {
//       console.log(
//         `Skipping review_update notification for vendor ${after.vendorId} - disabled in preferences`,
//       );
//       return null;
//     }

//     // Fetch the order's or booking's publicCode using orderId or bookingId from the review
//     let publicCode = null;
//     if (after.orderId) {
//       const orderSnap = await admin
//         .firestore()
//         .collection('orders')
//         .doc(after.orderId)
//         .get();
//       if (orderSnap.exists) {
//         publicCode = orderSnap.get('publicCode') || null;
//       }
//     }
//     if (!publicCode && after.bookingId) {
//       const bookingSnap = await admin
//         .firestore()
//         .collection('bookings')
//         .doc(after.bookingId)
//         .get();
//       if (bookingSnap.exists) {
//         publicCode = bookingSnap.get('publicCode') || null;
//       }
//     }

//     await admin
//       .firestore()
//       .collection('notifications')
//       .add({
//         userId: after.vendorId,
//         type: 'review_update',
//         reviewId: context.params.reviewId,
//         foodItemId: after.foodItemId || null,
//         clientName: after.clientName || null,
//         hideClientName: after.hideClientName || false,
//         publicCode: publicCode,
//         orderId: after.orderId || null,
//         bookingId: after.bookingId || null,
//         createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       });

//     return null;
//   });

// export const decrementReviewsCountOnReviewDelete = functions.firestore
//   .document('reviews/{reviewId}')
//   .onDelete(async (snap, context) => {
//     const review = snap.data();
//     const batch = admin.firestore().batch();

//     // Decrement vendor's reviewsCount and delete vendor rating doc if this is a vendor review (no foodItemId)
//     if (review.vendorId && !review.foodItemId) {
//       const vendorRef = admin
//         .firestore()
//         .collection('users')
//         .doc(review.vendorId);
//       batch.update(vendorRef, {
//         reviewsCount: admin.firestore.FieldValue.increment(-1),
//       });

//       // Also delete the vendor's rating doc for this client
//       if (review.clientId) {
//         const ratingRef = admin
//           .firestore()
//           .collection('users')
//           .doc(review.vendorId)
//           .collection('ratings')
//           .doc(review.clientId);
//         batch.delete(ratingRef);
//       }
//     }

//     // Decrement food item's reviewsCount and delete food item rating doc if this is a food review
//     if (review.foodItemId) {
//       const foodItemRef = admin
//         .firestore()
//         .collection('foodItems')
//         .doc(review.foodItemId);
//       batch.update(foodItemRef, {
//         reviewsCount: admin.firestore.FieldValue.increment(-1),
//       });

//       // Also delete the food item's rating doc for this client
//       if (review.clientId) {
//         const foodRatingRef = admin
//           .firestore()
//           .collection('foodItems')
//           .doc(review.foodItemId)
//           .collection('ratings')
//           .doc(review.clientId);
//         batch.delete(foodRatingRef);
//       }
//     }

//     await batch.commit();
//     return null;
//   });

// export const notifyClientOnVendorResponse = functions.firestore
//   .document('reviews/{reviewId}')
//   .onUpdate(async (change, context) => {
//     const before = change.before.data();
//     const after = change.after.data();

//     // Only notify if the response was added or changed
//     if (
//       (!before.response && after.response) ||
//       before.response?.text !== after.response?.text
//     ) {
//       // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
//       const shouldSend = await shouldSendNotification(
//         after.clientId,
//         'vendorResponse',
//       );
//       if (!shouldSend) {
//         console.log(
//           `Skipping vendor_response notification for client ${after.clientId} - disabled in preferences`,
//         );
//         return null;
//       }

//       // Fetch vendor name
//       let vendorName = '';
//       if (after.vendorId) {
//         const vendorDoc = await admin
//           .firestore()
//           .collection('users')
//           .doc(after.vendorId)
//           .get();
//         vendorName = vendorDoc.exists ? vendorDoc.get('name') || '' : '';
//       }

//       // Fetch publicCode from order or booking when available
//       let publicCode = null;
//       if (after.orderId) {
//         const orderSnap = await admin
//           .firestore()
//           .collection('orders')
//           .doc(after.orderId)
//           .get();
//         if (orderSnap.exists) publicCode = orderSnap.get('publicCode') || null;
//       }
//       if (!publicCode && after.bookingId) {
//         const bookingSnap = await admin
//           .firestore()
//           .collection('bookings')
//           .doc(after.bookingId)
//           .get();
//         if (bookingSnap.exists)
//           publicCode = bookingSnap.get('publicCode') || null;
//       }

//       await admin
//         .firestore()
//         .collection('notifications')
//         .add({
//           userId: after.clientId,
//           type: 'vendor_response',
//           reviewId: context.params.reviewId,
//           vendorId: after.vendorId,
//           vendorName: vendorName,
//           foodItemId: after.foodItemId || null,
//           publicCode: publicCode || after.publicCode || null,
//           hideClientName: after.hideClientName || false,
//           clientName: after.clientName || null,
//           responseText: after.response?.text || '',
//           createdAt: admin.firestore.FieldValue.serverTimestamp(),
//           timestamp: admin.firestore.FieldValue.serverTimestamp(),
//           read: false,
//         });
//     }
//     return null;
//   });

// export const notifyClientToReviewVendor = functions.firestore
//   .document('orders/{orderId}')
//   .onUpdate(async (change, context) => {
//     const before = change.before.data();
//     const after = change.after.data();

//     // Only proceed if status changed to 'delivered'
//     if (before.status === after.status || after.status !== 'delivered') {
//       return null;
//     }

//     // Get clientId and vendorId
//     const clientId = after.clientId;
//     const vendorId = after.vendorId;
//     if (!clientId || !vendorId) return null;

//     // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
//     const shouldSend = await shouldSendNotification(
//       clientId,
//       'request_vendor_review',
//     );
//     if (!shouldSend) {
//       console.log(
//         `Skipping request_vendor_review notification for client ${clientId} - disabled in preferences`,
//       );
//       return null;
//     }

//     // Get order public code
//     const publicCode = after.publicCode || '';
//     const reviewTimestamp = new Date(Date.now() + 1000); // 1 second later

//     // Create a notification for the client to review the vendor
//     await admin.firestore().collection('notifications').add({
//       userId: clientId,
//       type: 'request_vendor_review',
//       vendorId: vendorId,
//       orderId: context.params.orderId,
//       publicCode: publicCode,
//       createdAt: admin.firestore.FieldValue.serverTimestamp(),
//       timestamp: reviewTimestamp,
//       read: false,
//     });

//     return null;
//   });

// // export const rewardInviterOnVendorSubscription = functions.firestore
// //   .document("users/{vendorId}")
// //   .onUpdate(async (change, context) => {
// //     const before = change.before.data();
// //     const after = change.after.data();

// //     // Only proceed if role is vendor and menuSlots changed from falsy to truthy (subscription activated)
// //     if (
// //       after.role !== "vendor" ||
// //       !after.invitedBy ||
// //       before.menuSlots === after.menuSlots || // No change
// //       !after.menuSlots || // Not activated
// //       after.referralRewarded // Already rewarded
// //     ) {
// //       return null;
// //     }

// //     // Find inviter by referralCode
// //     const inviterQuery = await admin
// //       .firestore()
// //       .collection("users")
// //       .where("referralCode", "==", after.invitedBy)
// //       .limit(1)
// //       .get();

// //     if (inviterQuery.empty) {
// //       console.log(`No inviter found with referralCode: ${after.invitedBy}`);
// //       return null;
// //     }

// //     const inviterDoc = inviterQuery.docs[0];
// //     const inviterRef = inviterDoc.ref;
// //     const inviterId = inviterDoc.id;
// //     const inviterFcmToken = inviterDoc.get("fcmToken");

// //     // Add 15 credits to inviter
// //     const creditsToAdd = 15;
// //     await inviterRef.update({
// //       credits: admin.firestore.FieldValue.increment(creditsToAdd),
// //     });

// //     // Mark vendor as rewarded so it doesn't trigger again
// //     await change.after.ref.update({ referralRewarded: true });

// //     // Compose full name for notification
// //     const fullName = [after.name, after.lastName].filter(Boolean).join(" ");

// //     // Create notification document
// //     await admin.firestore().collection("notifications").add({
// //       userId: inviterId,
// //       type: "referral",
// //       creditsEarned: creditsToAdd,
// //       invitedPerson: fullName,
// //       createdAt: admin.firestore.FieldValue.serverTimestamp(),
// //       timestamp: admin.firestore.FieldValue.serverTimestamp(),
// //       read: false,
// //     });

// //     // Optionally, send push notification
// //     if (inviterFcmToken) {
// //       const payload = {
// //         notification: {
// //           title: "Referral Bonus!",
// //           body: "", // Let app translate
// //         },
// //         token: inviterFcmToken,
// //         data: {
// //           type: "referral",
// //           creditsEarned: String(creditsToAdd),
// //           invitedPerson: fullName,
// //         },
// //       };

// //       try {
// //         await admin.messaging().send(payload);
// //         console.log(`Push notification sent to inviter ${inviterId}`);
// //       } catch (err) {
// //         console.error("Error sending push notification:", err);
// //       }
// //     }

// //     console.log(
// //       `Allocated ${creditsToAdd} credits to inviter ${inviterId} for vendor ${context.params.vendorId}'s subscription`
// //     );
// //     return null;
// //   });

// export const rewardInviterOnVendorFirstFoodItem = functions.firestore
//   .document('foodItems/{foodItemId}')
//   .onCreate(async (snap, context) => {
//     const foodItem = snap.data();
//     if (!foodItem) return null;

//     const vendorId = foodItem.vendorId;
//     if (!vendorId) {
//       console.log('Food item has no vendorId, skipping referral reward.');
//       return null;
//     }

//     const vendorRef = admin.firestore().collection('users').doc(vendorId);
//     const vendorDoc = await vendorRef.get();
//     if (!vendorDoc.exists) {
//       console.log(`Vendor ${vendorId} not found`);
//       return null;
//     }
//     const vendorData = vendorDoc.data();

//     // Only proceed if vendor was invited and not already rewarded
//     const invitedBy = vendorData?.invitedBy;
//     if (!invitedBy) {
//       console.log(
//         `Vendor ${vendorId} was not invited, skipping referral reward.`,
//       );
//       return null;
//     }
//     if (vendorData?.referralRewarded) {
//       console.log(
//         `Vendor ${vendorId} already triggered referral reward, skipping.`,
//       );
//       return null;
//     }

//     // Find inviter by referralCode
//     const inviterQuery = await admin
//       .firestore()
//       .collection('users')
//       .where('referralCode', '==', invitedBy)
//       .limit(1)
//       .get();

//     if (inviterQuery.empty) {
//       console.log(`No inviter found with referralCode: ${invitedBy}`);
//       return null;
//     }

//     const inviterDoc = inviterQuery.docs[0];
//     const inviterRef = inviterDoc.ref;
//     const inviterId = inviterDoc.id;

//     const creditsToAdd = 10;

//     // Use transaction to avoid race conditions (e.g., multiple food items created concurrently)
//     try {
//       await admin.firestore().runTransaction(async tx => {
//         const freshVendorSnap = await tx.get(vendorRef);
//         if (!freshVendorSnap.exists) throw new Error('Vendor doc disappeared');
//         const freshVendor = freshVendorSnap.data();
//         if (freshVendor?.referralRewarded) {
//           throw new Error('Already rewarded in concurrent transaction');
//         }

//         tx.update(inviterRef, {
//           credits: admin.firestore.FieldValue.increment(creditsToAdd),
//         });

//         tx.update(vendorRef, {
//           referralRewarded: true,
//         });
//       });
//     } catch (err) {
//       // If transaction failed because already rewarded, quietly exit
//       if (String(err).includes('Already rewarded')) {
//         console.log('Referral already rewarded by concurrent transaction.');
//         return null;
//       }
//       console.error('Transaction error rewarding inviter:', err);
//       return null;
//     }

//     // Compose full name for notification
//     const fullName = [vendorData?.name, vendorData?.lastName]
//       .filter(Boolean)
//       .join(' ');

//     // Create notification document
//     await admin.firestore().collection('notifications').add({
//       userId: inviterId,
//       type: 'referral',
//       creditsEarned: creditsToAdd,
//       invitedPerson: fullName,
//       createdAt: admin.firestore.FieldValue.serverTimestamp(),
//       timestamp: admin.firestore.FieldValue.serverTimestamp(),
//       read: false,
//     });

//     // Optionally send push notification to inviter
//     try {
//       await sendPushWithBadge(inviterId, {
//         notification: {title: 'Referral Bonus!', body: ''},
//         data: {
//           type: 'referral',
//           creditsEarned: String(creditsToAdd),
//           invitedPerson: fullName,
//         },
//       });
//       console.log(`Attempted push notification to inviter ${inviterId}`);
//     } catch (err) {
//       console.error('Error sending push via helper:', err);
//     }

//     console.log(
//       `Allocated ${creditsToAdd} credits to inviter ${inviterId} for vendor ${vendorId}'s first food item`,
//     );
//     return null;
//   });

// // Aggregate vendor ratings when a rating is added/updated/deleted
// export const aggregateVendorRatings = functions.firestore
//   .document('users/{vendorId}/ratings/{clientId}')
//   .onWrite(async (change, context) => {
//     console.log('Vendor rating aggregation triggered!');

//     const vendorId = context.params.vendorId;
//     const ratingsRef = admin
//       .firestore()
//       .collection('users')
//       .doc(vendorId)
//       .collection('ratings');
//     const vendorRef = admin.firestore().collection('users').doc(vendorId);

//     const ratingsSnapshot = await ratingsRef.get();
//     let total = 0;
//     let count = 0;

//     ratingsSnapshot.forEach(doc => {
//       const data = doc.data();
//       if (typeof data.stars === 'number') {
//         total += data.stars;
//         count += 1;
//       }
//     });

//     const average = count > 0 ? total / count : 0;

//     try {
//       await vendorRef.update({
//         rating: average,
//         totalRatings: count,
//       });
//       console.log(
//         `Updated vendor ${vendorId}: rating=${average}, totalRatings=${count}`,
//       );
//     } catch (error) {
//       console.error('Error updating vendor rating:', error);
//     }

//     return null;
//   });

// // Ensure review ratings are mirrored into ratings subcollections so aggregation works
// export const syncReviewToRatings = functions.firestore
//   .document('reviews/{reviewId}')
//   .onCreate(async (snap, context) => {
//     const review = snap.data();
//     if (!review) return null;

//     const clientId = review.clientId;
//     const rating = review.rating;
//     if (!clientId || typeof rating !== 'number') return null;

//     const batch = admin.firestore().batch();

//     // Vendor-level rating (only when review is not a food-item review)
//     if (review.vendorId && !review.foodItemId) {
//       const vendorRatingRef = admin
//         .firestore()
//         .collection('users')
//         .doc(review.vendorId)
//         .collection('ratings')
//         .doc(clientId);
//       const existing = await vendorRatingRef.get();
//       if (!existing.exists) {
//         batch.set(vendorRatingRef, {
//           stars: rating,
//           reviewId: context.params.reviewId,
//           createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         });
//       }
//     }

//     // Food-item rating
//     if (review.foodItemId) {
//       const foodRatingRef = admin
//         .firestore()
//         .collection('foodItems')
//         .doc(review.foodItemId)
//         .collection('ratings')
//         .doc(clientId);
//       const existingFood = await foodRatingRef.get();
//       if (!existingFood.exists) {
//         batch.set(foodRatingRef, {
//           stars: rating,
//           reviewId: context.params.reviewId,
//           createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         });
//       }
//     }

//     if ((batch as any)._ops && (batch as any)._ops.length === 0) {
//       // No writes queued
//       return null;
//     }

//     try {
//       await batch.commit();
//     } catch (e) {
//       console.error('Failed to sync review to ratings:', e);
//     }
//     return null;
//   });

// export const notifyAdminOnSubscriptionReceipt = functions.firestore
//   .document('subscriptionPayments/{receiptId}')
//   .onCreate(async (snap, context) => {
//     const data = snap.data();
//     if (!data || data.status !== 'pending') return null;

//     // Get your email credentials from Firebase config
//     const adminEmail = 'samansaeedi102@gmail.com'; // Change to your admin email
//     const yahooEmail = (await GMAIL_EMAIL.value()) || '';
//     const yahooPassword = await GMAIL_PASSWORD.value();

//     if (!yahooEmail || !yahooPassword) {
//       console.error('❌ Yahoo credentials not configured');
//       throw new Error('Yahoo credentials not configured');
//     }

//     // Create transporter using Yahoo
//     const transporter = nodemailer.createTransport({
//       service: 'yahoo',
//       auth: {
//         user: yahooEmail,
//         pass: yahooPassword,
//       },
//     });

//     const mailOptions = {
//       from: yahooEmail,
//       to: adminEmail,
//       subject: `💳 New Vendor Subscription Payment - ${data.vendorId}`,
//       html: `
//     <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//       <h2>New Subscription Payment Receipt Submitted</h2>
//       <table style="width: 100%; border-collapse: collapse;">
//         <tr><td><b>Receipt ID:</b></td><td>${context.params.receiptId}</td></tr>
//         <tr><td><b>Vendor ID:</b></td><td>${data.vendorId}</td></tr>
//         <tr><td><b>Plan:</b></td><td>${data.plan}</td></tr>
//         <tr><td><b>Amount:</b></td><td>${data.amount} €</td></tr>
//         <tr><td><b>Payment Method:</b></td><td>${data.paymentMethod}</td></tr>
//         <tr><td><b>Created At:</b></td><td>${data.createdAt}</td></tr>
//         <tr><td><b>Receipt Image:</b></td><td><a href="${data.proofUrl}">View Image</a></td></tr>
//       </table>
//       <p>
//         <a href="https://console.firebase.google.com/project/YOUR_PROJECT_ID/firestore/data/~2FsubscriptionPayments~2F${context.params.receiptId}">
//           🔗 View this receipt in Firestore
//         </a>
//       </p>
//     </div>
//   `,
//     };

//     try {
//       await transporter.sendMail(mailOptions);
//       console.log('✅ Admin notified about new subscription payment receipt');
//     } catch (error) {
//       console.error('❌ Failed to send admin email:', error);
//     }

//     return null;
//   });

// // Aggregate food item ratings when a rating is added/updated/deleted
// export const aggregateFoodItemRatings = functions.firestore
//   .document('foodItems/{foodItemId}/ratings/{clientId}')
//   .onWrite(async (change, context) => {
//     console.log('Food item rating aggregation triggered!');

//     const foodItemId = context.params.foodItemId;
//     const foodItemRef = admin
//       .firestore()
//       .collection('foodItems')
//       .doc(foodItemId);
//     const ratingsSnap = await foodItemRef.collection('ratings').get();

//     let totalStars = 0;
//     let totalRatings = ratingsSnap.size;

//     ratingsSnap.forEach(doc => {
//       const data = doc.data();
//       if (typeof data.stars === 'number') {
//         totalStars += data.stars;
//       }
//     });

//     const avgRating = totalRatings > 0 ? totalStars / totalRatings : 0;

//     await foodItemRef.update({
//       rating: Math.round(avgRating * 10) / 10, // round to 1 decimal
//       totalRatings: totalRatings,
//     });

//     console.log(
//       `Updated food item ${foodItemId}: rating=${avgRating}, totalRatings=${totalRatings}`,
//     );
//   });

// // Notify vendor when a new order is created
// export const notifyVendorOnNewOrder = functions.firestore
//   .document('orders/{orderId}')
//   .onCreate(async (snap, context) => {
//     const order = snap.data();
//     if (!order) return null;

//     const vendorId = order.vendorId;
//     const clientName = order.clientName || '';
//     const publicCode = order.publicCode || ''; // ✅ This gets the publicCode from the order
//     const orderId = context.params.orderId;

//     if (!vendorId) {
//       console.log('No vendor ID found for order');
//       return null;
//     }

//     // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
//     const shouldSend = await shouldSendNotification(vendorId, 'newOrder');
//     if (!shouldSend) {
//       console.log(
//         `Skipping new order notification for vendor ${vendorId} - disabled in preferences`,
//       );
//       return null;
//     }

//     try {
//       // Create notification for vendor
//       await admin.firestore().collection('notifications').add({
//         userId: vendorId,
//         type: 'newOrder',
//         orderId: orderId,
//         publicCode: publicCode, // ✅ Now publicCode will be available
//         clientName: clientName,
//         createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       });

//       console.log(
//         `New order notification created for vendor ${vendorId}, order ${
//           publicCode || orderId
//         }`,
//       );
//     } catch (error) {
//       console.error('Error creating new order notification:', error);
//     }

//     return null;
//   });

// // Notify client when order status changes
// export const notifyClientOnOrderStatusChange = functions.firestore
//   .document('orders/{orderId}')
//   .onUpdate(async (change, context) => {
//     const before = change.before.data();
//     const after = change.after.data();

//     // Only proceed if status actually changed
//     if (before.status === after.status) {
//       return null;
//     }

//     const clientId = after.clientId;
//     const orderId = context.params.orderId;
//     const publicCode = after.publicCode || orderId;
//     const clientName = after.clientInfo?.name
//       ? `${after.clientInfo.name} ${after.clientInfo.lastName || ''}`.trim()
//       : after.clientName || '';

//     if (!clientId) {
//       console.log('No client ID found for order');
//       return null;
//     }

//     // Determine notification type based on new status
//     let notificationType = '';

//     switch (after.status) {
//       case 'accepted':
//         notificationType = 'orderAccepted';
//         break;
//       case 'rejected':
//         notificationType = 'orderRejected';
//         break;
//       case 'delivered':
//         notificationType = 'orderDelivered';
//         break;
//       case 'expired':
//         // New: map an expired order to an orderExpired notification
//         notificationType = 'orderExpired';
//         break;
//       default:
//         console.log(`No notification needed for status: ${after.status}`);
//         return null;
//     }

//     // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
//     const shouldSend = await shouldSendNotification(clientId, notificationType);
//     if (!shouldSend) {
//       console.log(
//         `Skipping ${notificationType} notification for client ${clientId} - disabled in preferences`,
//       );
//       return null;
//     }

//     try {
//       // ✅ CREATE NOTIFICATION DATA WITH ALL FIELDS DEFINED UPFRONT
//       let notificationData: any = {
//         userId: clientId,
//         type: notificationType,
//         orderId: orderId,
//         publicCode: publicCode,
//         clientName: clientName,
//         vendorId: after.vendorId,
//         rejectionReason: after.rejectionReason || null,
//         createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       };

//       // ✅ ADD TYPE-SPECIFIC FIELDS BASED ON STATUS
//       if (notificationType === 'orderAccepted') {
//         const deliveryDate = after.deliveryDate || after.selectedDate;
//         notificationData = {
//           ...notificationData,
//           deliveryDate: deliveryDate || null,
//           delivered: false,
//         };
//       } else if (notificationType === 'orderDelivered') {
//         notificationData = {
//           ...notificationData,
//           delivered: true,
//         };
//       } else if (notificationType === 'orderExpired') {
//         // Include expiry-specific metadata so the app can display a translated message
//         notificationData = {
//           ...notificationData,
//           expired: true,
//           expiredAt:
//             after.expiredAt || admin.firestore.FieldValue.serverTimestamp(),
//           expiryReason: after.expiryReason || null,
//         };
//       }

//       // If order was accepted and it's a pickup, mark related holds as accepted
//       if (after.status === 'accepted' && after.deliveryMethod === 'pickup') {
//         try {
//           const holdsQuery = await admin
//             .firestore()
//             .collection('pickupSlotHolds')
//             .where('orderId', '==', orderId)
//             .where('status', '==', 'active')
//             .get();

//           const batch = admin.firestore().batch();
//           holdsQuery.docs.forEach(h => {
//             batch.update(h.ref, {
//               status: 'accepted',
//               acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
//             });
//           });

//           await batch.commit();
//           console.log(
//             `Accepted ${holdsQuery.size} pickup holds for order ${orderId}`,
//           );
//         } catch (err) {
//           console.error(
//             'Failed to confirm pickup holds for accepted order:',
//             err,
//           );
//         }
//       }

//       // Create notification for client
//       await admin.firestore().collection('notifications').add(notificationData);

//       console.log(
//         `${notificationType} notification created for client ${clientId}, order ${publicCode}`,
//       );
//     } catch (error) {
//       console.error(`Error creating ${notificationType} notification:`, error);
//     }

//     return null;
//   });

// export const sendPushOnNotificationCreate = functions.firestore
//   .document('notifications/{notificationId}')
//   .onCreate(async (snap: functions.firestore.DocumentSnapshot) => {
//     console.log('Notification push function triggered!');

//     const notification = snap.data();
//     if (!notification) {
//       console.log('No notification data found.');
//       return null;
//     }

//     const userId = notification.userId;
//     if (!userId) {
//       console.log('Notification missing userId, skipping push.');
//       return null;
//     }

//     const notificationType = notification.type || 'general';

//     // Respect user preferences
//     const shouldSend = await shouldSendNotification(userId, notificationType);
//     if (!shouldSend) {
//       console.log(
//         `Skipping notification for user ${userId}, type ${notificationType} - disabled in preferences`,
//       );
//       return null;
//     }

//     // Fetch role (helper may use tokens + badge logic)
//     const userDoc = await admin
//       .firestore()
//       .collection('users')
//       .doc(userId)
//       .get();
//     const userRole = userDoc.exists
//       ? userDoc.get('role') || 'client'
//       : 'client';

//     // Build a data-only payload. Client will localize / render title/body from `type` + `payload`.
//     const dataPayload: Record<string, string> = {
//       type: String(notificationType),
//       userId: String(userId),
//       userRole: String(userRole),
//       message: String(notification.message || ''),
//       orderId: String(notification.orderId || ''),
//       publicCode: String(notification.publicCode || ''),
//       // stringify full notification so client has every field available for interpolation
//       payload: JSON.stringify(notification),
//     };

//     // Add a few commonly-used fields if present
//     if (notification.invitedPerson)
//       dataPayload.invitedPerson = String(notification.invitedPerson);
//     if (notification.creditsEarned)
//       dataPayload.creditsEarned = String(notification.creditsEarned);
//     if (notification.vendorName)
//       dataPayload.vendorName = String(notification.vendorName);
//     if (notification.clientName)
//       dataPayload.clientName = String(notification.clientName);

//     const basePayload: Partial<admin.messaging.Message> = {
//       data: dataPayload,
//       android: {priority: 'high' as const},
//       apns: {payload: {aps: {'content-available': 1}}},
//     };

//     try {
//       await sendPushWithBadge(userId, basePayload);
//       console.log('Dispatched push via helper for user:', userId);
//     } catch (error) {
//       console.error('Error dispatching push via helper:', error);
//     }

//     return null;
//   });

// export const sendChatPushNotification = functions.https.onCall(
//   async (data, context) => {
//     console.log('Chat push notification function triggered!');

//     if (!context.auth) {
//       throw new functions.https.HttpsError(
//         'unauthenticated',
//         'User must be authenticated',
//       );
//     }

//     const {recipientId, senderName, message, conversationId} = data || {};

//     if (!recipientId || !senderName || !message) {
//       throw new functions.https.HttpsError(
//         'invalid-argument',
//         'recipientId, senderName, and message are required',
//       );
//     }

//     // Respect user preferences for chat messages
//     const shouldSend = await shouldSendNotification(recipientId, 'chatMessage');
//     if (!shouldSend) {
//       console.log(
//         `Skipping chat notification for user ${recipientId} - disabled in preferences`,
//       );
//       return {success: false, reason: 'Chat notifications disabled by user'};
//     }

//     try {
//       // Fetch recipient doc
//       const userDoc = await admin
//         .firestore()
//         .collection('users')
//         .doc(recipientId)
//         .get();

//       const fcmToken = userDoc.exists ? userDoc.get('fcmToken') : null;
//       const userRole = userDoc.exists
//         ? userDoc.get('role') || 'client'
//         : 'client';

//       console.log('FCM token retrieved:', fcmToken);

//       if (!fcmToken) {
//         console.log('No FCM token found for user:', recipientId);
//         return {success: false, reason: 'No FCM token found'};
//       }

//       // Build notification payload
//       const notificationTitle = 'New Message';
//       const notificationBody = `${senderName}: ${
//         typeof message === 'string' && message.length > 50
//           ? message.substring(0, 50) + '...'
//           : message
//       }`;

//       // Send via centralized helper (basePayload built below)
//       const basePayload: Partial<admin.messaging.Message> = {
//         notification: {title: notificationTitle, body: notificationBody},
//         data: {
//           title: notificationTitle,
//           body: notificationBody,
//           type: 'chat_message',
//           senderId: context.auth.uid,
//           senderName,
//           conversationId: conversationId || '',
//           originalMessage: String(message),
//           userRole,
//           // for chat messages we don't create a notification doc here; the conversationId
//           // will be used as the android notification tag so the client can cancel by conversation
//           notificationId: conversationId || '',
//         },
//         android: {
//           notification: {
//             title: notificationTitle,
//             body: notificationBody,
//             icon: 'ic_notification',
//             color: '#FF6B35',
//             tag: conversationId || undefined,
//             sound: 'default',
//           },
//           priority: 'high' as const,
//         },
//         apns: {
//           payload: {
//             aps: {
//               alert: {title: notificationTitle, body: notificationBody},
//               sound: 'default',
//             },
//           },
//         },
//       };

//       try {
//         const res: any = await sendPushWithBadge(recipientId, basePayload);
//         if (res && res.successCount && res.successCount > 0) {
//           return {success: true, messageId: 'multicast'};
//         }
//         return {success: false, reason: 'No devices accepted the message'};
//       } catch (error: any) {
//         console.error('Error sending chat push via helper:', error);
//         return {success: false, error};
//       }
//     } catch (error: any) {
//       console.error('Unexpected error in chat push flow:', error);
//       return {success: false, error};
//     }
//   },
// );

// // Update APNs badge when a notification's `read` flag changes
// export const updateBadgeOnNotificationUpdate = functions.firestore
//   .document('notifications/{notificationId}')
//   .onUpdate(async (change, context) => {
//     try {
//       const before = change.before.data();
//       const after = change.after.data();
//       if (!before || !after) return null;

//       // Only act when `read` changed
//       if (before.read === after.read) return null;

//       const userId = after.userId || before.userId;
//       if (!userId) return null;

//       // Send a badge-only update (helper computes badge)
//       try {
//         await sendPushWithBadge(userId, {data: {type: 'badge_update'}});
//       } catch (err) {
//         // error sending badge update (not logged in production)
//       }
//     } catch (error) {
//       // unexpected error in updateBadgeOnNotificationUpdate (not logged)
//     }
//     return null;
//   });

// // Update order statistics when an order status changes
// // Cloud Function: updateOrderStatistics
// export const updateOrderStatistics = functions.firestore
//   .document('orders/{orderId}')
//   .onWrite(async (change, context) => {
//     console.log('Order statistics update triggered!');

//     const beforeData = change.before.exists ? change.before.data() : null;
//     const afterData = change.after.exists ? change.after.data() : null;

//     // Only process if status changed
//     const beforeStatus = beforeData?.status;
//     const afterStatus = afterData?.status;

//     if (beforeStatus === afterStatus) {
//       return null;
//     }

//     // Use vendorId from afterData if exists, else from beforeData (for deletions)
//     const vendorId = afterData ? afterData.vendorId : beforeData?.vendorId;
//     if (!vendorId) {
//       console.log('No vendor ID found for order');
//       return null;
//     }

//     try {
//       const vendorRef = admin.firestore().collection('users').doc(vendorId);
//       const vendorDoc = await vendorRef.get();
//       const vendorData = vendorDoc.data();

//       if (!vendorData) {
//         console.log('Vendor not found');
//         return null;
//       }

//       // Initialize statistics if they don't exist
//       const stats = vendorData.orderStatistics || {
//         totalOrders: 0,
//         completedOrders: 0,
//         pendingOrders: 0,
//         rejectedOrders: 0,
//         expiredOrders: 0,
//         acceptedOrders: 0,
//       };

//       // Handle order deletion
//       if (!afterData) {
//         if (beforeStatus === 'pending') {
//           stats.pendingOrders = Math.max(0, (stats.pendingOrders || 0) - 1);
//         }
//         if (beforeStatus === 'delivered') {
//           stats.completedOrders = Math.max(0, (stats.completedOrders || 0) - 1);
//         }
//         if (beforeStatus === 'rejected') {
//           stats.rejectedOrders = Math.max(0, (stats.rejectedOrders || 0) - 1);
//         }
//         if (beforeStatus === 'expired') {
//           stats.expiredOrders = Math.max(0, (stats.expiredOrders || 0) - 1);
//         }
//         if (beforeStatus === 'accepted') {
//           stats.acceptedOrders = Math.max(0, (stats.acceptedOrders || 0) - 1);
//         }
//         stats.totalOrders = Math.max(0, (stats.totalOrders || 0) - 1);

//         await vendorRef.update({
//           orderStatistics: stats,
//           lastOrderUpdate: admin.firestore.FieldValue.serverTimestamp(),
//         });
//         return null;
//       }

//       // Status transitions
//       if (afterStatus === 'delivered' && beforeStatus !== 'delivered') {
//         stats.completedOrders = (stats.completedOrders || 0) + 1;
//       }
//       if (afterStatus === 'rejected' && beforeStatus !== 'rejected') {
//         stats.rejectedOrders = (stats.rejectedOrders || 0) + 1;
//       }
//       if (afterStatus === 'expired' && beforeStatus !== 'expired') {
//         stats.expiredOrders = (stats.expiredOrders || 0) + 1;
//       }
//       if (afterStatus === 'accepted' && beforeStatus !== 'accepted') {
//         // Count accepted orders as ongoing
//         stats.acceptedOrders = (stats.acceptedOrders || 0) + 1;
//       }
//       // Only increment pendingOrders on status change to "pending" if not a new order
//       if (
//         beforeStatus !== afterStatus &&
//         afterStatus === 'pending' &&
//         beforeData
//       ) {
//         stats.pendingOrders = (stats.pendingOrders || 0) + 1;
//       }
//       if (afterStatus === 'accepted' && beforeStatus !== 'accepted') {
//         // Transitional state, do nothing
//       }
//       if (beforeStatus === 'delivered' && afterStatus !== 'delivered') {
//         stats.completedOrders = Math.max(0, (stats.completedOrders || 0) - 1);
//       }
//       if (beforeStatus === 'rejected' && afterStatus !== 'rejected') {
//         stats.rejectedOrders = Math.max(0, (stats.rejectedOrders || 0) - 1);
//       }
//       if (beforeStatus === 'expired' && afterStatus !== 'expired') {
//         stats.expiredOrders = Math.max(0, (stats.expiredOrders || 0) - 1);
//       }
//       if (beforeStatus === 'accepted' && afterStatus !== 'accepted') {
//         stats.acceptedOrders = Math.max(0, (stats.acceptedOrders || 0) - 1);
//       }
//       if (beforeStatus === 'pending' && afterStatus !== 'pending') {
//         stats.pendingOrders = Math.max(0, (stats.pendingOrders || 0) - 1);
//       }
//       if (!beforeData) {
//         stats.totalOrders = (stats.totalOrders || 0) + 1;
//         if (afterStatus === 'pending') {
//           stats.pendingOrders = (stats.pendingOrders || 0) + 1;
//         }
//         if (afterStatus === 'delivered') {
//           stats.completedOrders = (stats.completedOrders || 0) + 1;
//         }
//         if (afterStatus === 'expired') {
//           stats.expiredOrders = (stats.expiredOrders || 0) + 1;
//         }
//         if (afterStatus === 'accepted') {
//           stats.acceptedOrders = (stats.acceptedOrders || 0) + 1;
//         }
//       }

//       await vendorRef.update({
//         orderStatistics: stats,
//         lastOrderUpdate: admin.firestore.FieldValue.serverTimestamp(),
//       });

//       console.log(`Updated vendor ${vendorId} statistics:`, stats);
//     } catch (error) {
//       console.error('Error updating order statistics:', error);
//     }

//     return null;
//   });

// export const notifyVendorsOfUpcomingOrders = functions.pubsub
//   .schedule('every day 07:00') // Run every day at 7 AM UTC
//   .timeZone('UTC')
//   .onRun(async _context => {
//     const db = admin.firestore();
//     const now = new Date();
//     now.setHours(0, 0, 0, 0);
//     const twoDaysLater = new Date(now);
//     twoDaysLater.setDate(now.getDate() + 2);

//     // Query orders with deliveryDate in [now, twoDaysLater], status pending or accepted
//     const ordersSnap = await db
//       .collection('orders')
//       .where('deliveryDate', '>=', now.toISOString())
//       .where('deliveryDate', '<=', twoDaysLater.toISOString())
//       .where('status', 'in', ['pending', 'accepted'])
//       .get();

//     if (ordersSnap.empty) {
//       console.log('No upcoming orders found.');
//       return null;
//     }

//     const notifications: any[] = [];

//     for (const doc of ordersSnap.docs) {
//       const order = doc.data();
//       const vendorId = order.vendorId;
//       if (!vendorId) continue;

//       // Check if a notification for this order & vendor already exists (avoid duplicates)
//       const existing = await db
//         .collection('notifications')
//         .where('userId', '==', vendorId)
//         .where('type', '==', 'upcomingOrder')
//         .where('orderId', '==', doc.id)
//         .get();
//       if (!existing.empty) continue;

//       notifications.push({
//         userId: vendorId,
//         type: 'upcomingOrder',
//         orderId: doc.id,
//         publicCode: order.publicCode || '',
//         deliveryDate: order.deliveryDate,
//         clientName: order.clientName || '',
//         createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       });
//     }

//     // Batch create notifications
//     const batch = db.batch();
//     notifications.forEach(notif => {
//       const ref = db.collection('notifications').doc();
//       batch.set(ref, notif);
//     });
//     if (notifications.length > 0) {
//       await batch.commit();
//       console.log(
//         `Created ${notifications.length} upcoming order notifications.`,
//       );
//     }

//     return null;
//   });

// // Clean up old notifications (runs daily)
// export const cleanupOldNotifications = functions.pubsub
//   .schedule('0 2 * * *') // Run at 2 AM daily
//   .timeZone('UTC')
//   .onRun(async (_context: functions.EventContext) => {
//     console.log('Cleaning up old notifications...');

//     const thirtyDaysAgo = new Date();
//     thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

//     try {
//       const oldNotificationsQuery = admin
//         .firestore()
//         .collection('notifications')
//         .where('timestamp', '<', thirtyDaysAgo)
//         .limit(500); // Process in batches

//       const snapshot = await oldNotificationsQuery.get();

//       if (snapshot.empty) {
//         console.log('No old notifications to clean up');
//         return;
//       }

//       const batch = admin.firestore().batch();
//       let count = 0;

//       snapshot.forEach(doc => {
//         batch.delete(doc.ref);
//         count++;
//       });

//       await batch.commit();
//       console.log(`Deleted ${count} old notifications`);
//     } catch (error) {
//       console.error('Error cleaning up old notifications:', error);
//     }
//   });

// // Send email notification to admin when restaurant submits documents
// export const notifyAdminRestaurantSubmission = functions.firestore
//   .document('users/{userId}')
//   .onUpdate(async (change, context) => {
//     console.log('Restaurant submission notification triggered!');

//     const before = change.before.data();
//     const after = change.after.data();
//     const userId = context.params.userId;

//     // Check if this is a restaurant that just submitted documents
//     if (
//       after.role === 'vendor' &&
//       after.type === 'restaurant' &&
//       before.certification?.status !== 'under_review' &&
//       after.certification?.status === 'under_review' &&
//       after.certification?.documentsSubmittedAt
//     ) {
//       console.log(`Restaurant ${userId} submitted documents for review`);

//       const restaurantData = {
//         id: userId,
//         name: `${after.name} ${after.lastName}`,
//         email: after.email,
//         phone: after.phone,
//         location: after.location,
//         description: after.description,
//         submittedAt: after.certification.documentsSubmittedAt,
//         businessLicenseUrl: after.certification.businessLicenseUrl,
//         sanitaryCertificationUrl: after.certification.sanitaryCertificationUrl,
//         workPermitUrl: after.certification.workPermitUrl,
//       };

//       try {
//         // Send email notification
//         await sendAdminEmailWithYahoo(restaurantData);

//         // Also log to admin notifications collection for dashboard
//         await admin
//           .firestore()
//           .collection('adminNotifications')
//           .add({
//             type: 'restaurant_submission',
//             restaurantId: userId,
//             restaurantName: restaurantData.name,
//             restaurantEmail: restaurantData.email,
//             submittedAt: restaurantData.submittedAt,
//             createdAt: admin.firestore.FieldValue.serverTimestamp(),
//             read: false,
//             priority: 'high',
//             message: `New restaurant "${restaurantData.name}" has submitted documents for approval`,
//           });

//         console.log(
//           `✅ Admin notified about restaurant: ${restaurantData.name}`,
//         );
//       } catch (error) {
//         console.error('❌ Failed to notify admin:', error);
//       }
//     }

//     return null;
//   });

// // Helper function to send email using Yahoo Mail
// async function sendAdminEmailWithYahoo(restaurant: any) {
//   const nodemailer = require('nodemailer');

//   // Get Yahoo credentials from Firebase config
//   const yahooEmail = (await GMAIL_EMAIL.value()) || '';
//   const yahooPassword = await GMAIL_PASSWORD.value();

//   if (!yahooEmail || !yahooPassword) {
//     console.error('❌ Yahoo credentials not configured');
//     throw new Error('Yahoo credentials not configured');
//   }

//   // Create transporter using Yahoo
//   const transporter = nodemailer.createTransport({
//     service: 'yahoo',
//     auth: {
//       user: yahooEmail,
//       pass: yahooPassword,
//     },
//   });

//   const adminEmail = 'samansaeedi102@gmail.com'; // Send to your Yahoo email

//   const mailOptions = {
//     from: yahooEmail,
//     to: adminEmail,
//     subject: `🏪 New Restaurant Pending Approval - ${restaurant.name}`,
//     html: `
//       <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//         <div style="background: linear-gradient(135deg, #25567a 0%, #1e4a6b 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
//           <h1 style="margin: 0; font-size: 24px;">🏪 Keetchen Admin Alert</h1>
//           <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">New Restaurant Submission</p>
//         </div>
        
//         <div style="background: white; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 12px 12px; padding: 30px;">
//           <div style="background-color: #f8f9fa; padding: 25px; border-radius: 8px; margin-bottom: 25px;">
//             <h2 style="color: #25567a; margin: 0 0 20px 0; font-size: 20px;">📋 Restaurant Details</h2>
//             <table style="width: 100%; border-collapse: collapse;">
//               <tr style="border-bottom: 1px solid #e9ecef;">
//                 <td style="padding: 8px 0; font-weight: bold; color: #495057;">Name:</td>
//                 <td style="padding: 8px 0; color: #212529;">${
//                   restaurant.name
//                 }</td>
//               </tr>
//               <tr style="border-bottom: 1px solid #e9ecef;">
//                 <td style="padding: 8px 0; font-weight: bold; color: #495057;">Email:</td>
//                 <td style="padding: 8px 0; color: #212529;">${
//                   restaurant.email
//                 }</td>
//               </tr>
//               <tr style="border-bottom: 1px solid #e9ecef;">
//                 <td style="padding: 8px 0; font-weight: bold; color: #495057;">Phone:</td>
//                 <td style="padding: 8px 0; color: #212529;">${
//                   restaurant.phone
//                 }</td>
//               </tr>
//               <tr style="border-bottom: 1px solid #e9ecef;">
//                 <td style="padding: 8px 0; font-weight: bold; color: #495057;">Location:</td>
//                 <td style="padding: 8px 0; color: #212529;">${
//                   restaurant.location?.city
//                 }, ${restaurant.location?.country}</td>
//               </tr>
//               <tr style="border-bottom: 1px solid #e9ecef;">
//                 <td style="padding: 8px 0; font-weight: bold; color: #495057;">Description:</td>
//                 <td style="padding: 8px 0; color: #212529;">${
//                   restaurant.description
//                 }</td>
//               </tr>
//               <tr style="border-bottom: 1px solid #e9ecef;">
//                 <td style="padding: 8px 0; font-weight: bold; color: #495057;">Submitted:</td>
//                 <td style="padding: 8px 0; color: #212529;">${new Date(
//                   restaurant.submittedAt,
//                 ).toLocaleString()}</td>
//               </tr>
//               <tr>
//                 <td style="padding: 8px 0; font-weight: bold; color: #495057;">Restaurant ID:</td>
//                 <td style="padding: 8px 0; color: #212529; font-family: monospace; background: #f1f3f4; padding: 4px 8px; border-radius: 4px;">${
//                   restaurant.id
//                 }</td>
//               </tr>
//             </table>
//           </div>

//           <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 25px; margin-bottom: 25px;">
//             <h3 style="color: #856404; margin: 0 0 15px 0; font-size: 18px;">📄 Documents to Review</h3>
//             <div style="display: flex; flex-direction: column; gap: 12px;">
//               <a href="${restaurant.businessLicenseUrl}" target="_blank" 
//                  style="display: inline-block; background: #25567a; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; text-align: center;">
//                 📄 View Business License
//               </a>
//               <a href="${restaurant.sanitaryCertificationUrl}" target="_blank" 
//                  style="display: inline-block; background: #28a745; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; text-align: center;">
//                 🏥 View Sanitary Certification
//               </a>
//               <a href="${restaurant.workPermitUrl}" target="_blank" 
//                  style="display: inline-block; background: #17a2b8; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; text-align: center;">
//                 🛂 View Work Permit
//               </a>
//             </div>
//           </div>

//           <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; border-radius: 8px; padding: 25px; margin-bottom: 25px;">
//             <h3 style="color: #0c5460; margin: 0 0 15px 0; font-size: 18px;">⚡ Next Steps</h3>
//             <ol style="color: #0c5460; margin: 0; padding-left: 20px;">
//               <li style="margin-bottom: 8px;">Review all uploaded documents by clicking the buttons above</li>
//               <li style="margin-bottom: 8px;">Run your admin verification script: <code style="background: #f8f9fa; padding: 2px 6px; border-radius: 3px;">node verify-restaurants.js</code></li>
//               <li style="margin-bottom: 8px;">Approve or reject the restaurant application</li>
//             </ol>
//           </div>

//           <div style="background-color: #f8f9fa; border-radius: 8px; padding: 20px; text-align: center;">
//             <p style="margin: 0; color: #6c757d; font-size: 14px;">
//               📧 This is an automated notification from Keetchen Admin System
//             </p>
//             <p style="margin: 8px 0 0 0; color: #adb5bd; font-size: 12px;">
//               Restaurant Status: Under Review | Priority: High | ${new Date().toLocaleString()}
//             </p>
//           </div>
//         </div>
//       </div>
//     `,
//   };

//   try {
//     await transporter.sendMail(mailOptions);
//     console.log('✅ Yahoo email sent successfully to:', adminEmail);
//   } catch (error) {
//     console.error('❌ Yahoo email error:', error);
//     throw error;
//   }
// }

// // Add this to your existing index.ts file:

// // Send email notification to vendor when admin approves/rejects restaurant
// export const notifyVendorCertificationUpdate = functions.firestore
//   .document('users/{userId}')
//   .onUpdate(async (change, context) => {
//     console.log('Vendor certification update notification triggered!');

//     const before = change.before.data();
//     const after = change.after.data();
//     const userId = context.params.userId;

//     // Check if this is a restaurant certification status change
//     if (
//       after.role === 'vendor' &&
//       after.type === 'restaurant' &&
//       before.certification?.status !== after.certification?.status &&
//       (after.certification?.status === 'certified' ||
//         after.certification?.status === 'rejected')
//     ) {
//       console.log(
//         `Restaurant ${userId} certification status changed to: ${after.certification.status}`,
//       );

//       const restaurantData = {
//         id: userId,
//         name: `${after.name} ${after.lastName}`,
//         email: after.email,
//         status: after.certification.status,
//         rejectionReason: after.certification.rejectionReason,
//       };

//       try {
//         await sendVendorCertificationEmail(restaurantData);
//         console.log(
//           `✅ Vendor notified about certification: ${restaurantData.status}`,
//         );
//       } catch (error) {
//         console.error('❌ Failed to notify vendor:', error);
//       }
//     }

//     return null;
//   });

// // Helper function to send certification email to vendor
// async function sendVendorCertificationEmail(restaurant: any) {
//   const nodemailer = require('nodemailer');

//   const yahooEmail = (await GMAIL_EMAIL.value()) || '';
//   const yahooPassword = await GMAIL_PASSWORD.value();

//   if (!yahooEmail || !yahooPassword) {
//     throw new Error('Yahoo credentials not configured');
//   }

//   const transporter = nodemailer.createTransport({
//     service: 'yahoo',
//     auth: {
//       user: yahooEmail,
//       pass: yahooPassword,
//     },
//   });

//   const isApproved = restaurant.status === 'certified';
//   const subject = isApproved
//     ? `🎉 Welcome to Keetchen - ${restaurant.name}`
//     : `📄 Document Update Required - ${restaurant.name}`;

//   const mailOptions = {
//     from: yahooEmail,
//     to: restaurant.email,
//     subject: subject,
//     html: generateVendorEmailTemplate(restaurant, isApproved),
//   };

//   await transporter.sendMail(mailOptions);
//   console.log(`✅ Vendor email sent successfully to: ${restaurant.email}`);
// }

// // Email template generator for vendor notifications
// function generateVendorEmailTemplate(restaurant: any, isApproved: boolean) {
//   if (isApproved) {
//     return `
//       <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
        
//         <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center;">
//           <h1 style="margin: 0; font-size: 24px;">🎉 Congratulations!</h1>
//           <p style="margin: 10px 0 0 0; font-size: 16px;">Your restaurant is approved</p>
//         </div>
        
//         <div style="padding: 30px;">
//           <h2 style="color: #28a745; margin: 0 0 20px 0; font-size: 20px; text-align: center;">Welcome to Keetchen!</h2>
          
//           <div style="background: #d4edda; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
//             <h3 style="color: #155724; margin: 0 0 10px 0; font-size: 16px;">✅ You're all set!</h3>
//             <p style="color: #155724; margin: 0; font-size: 14px; line-height: 1.4;">
//               Your restaurant "${restaurant.name}" is now live and ready to receive orders.
//             </p>
//           </div>

//           <div style="background: #fff3cd; border-radius: 8px; padding: 20px; text-align: center;">
//             <p style="color: #856404; margin: 0; font-size: 14px; font-weight: bold;">
//               📱 Restart your Keetchen app to see the updates
//             </p>
//           </div>
//         </div>
//       </div>
//     `;
//   } else {
//     return `
//       <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
        
//         <div style="background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); color: white; padding: 30px; text-align: center;">
//           <h1 style="margin: 0; font-size: 20px;">📄 Update Required</h1>
//           <p style="margin: 10px 0 0 0; font-size: 16px;">Document review completed</p>
//         </div>
        
//         <div style="padding: 30px;">
//           <h2 style="color: #dc3545; margin: 0 0 20px 0; font-size: 18px; text-align: center;">Please resubmit documents</h2>
          
//           <div style="background: #f8d7da; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
//             <h3 style="color: #721c24; margin: 0 0 10px 0; font-size: 16px;">📝 Admin feedback:</h3>
//             <p style="color: #721c24; margin: 0; font-size: 14px; line-height: 1.4;">
//               "${
//                 restaurant.rejectionReason ||
//                 'Please review and resubmit your documents.'
//               }"
//             </p>
//           </div>

//           <div style="background: #d1ecf1; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
//             <h3 style="color: #0c5460; margin: 0 0 10px 0; font-size: 16px;">🔄 What to do:</h3>
//             <p style="color: #0c5460; margin: 0; font-size: 14px; line-height: 1.4;">
//               1. Fix the mentioned issues<br>
//               2. Open your Keetchen app<br>
//               3. Tap "Resubmit Documents"
//             </p>
//           </div>

//           <div style="background: #fff3cd; border-radius: 8px; padding: 20px; text-align: center;">
//             <p style="color: #856404; margin: 0; font-size: 14px; font-weight: bold;">
//               📱 Restart your Keetchen app to see the updates
//             </p>
//           </div>
//         </div>
//       </div>
//     `;
//   }
// }

// export const releaseExpiredHolds = functions.pubsub
//   .schedule('every 1 minutes')
//   .timeZone('UTC')
//   .onRun(async () => {
//     const db = admin.firestore();
//     const now = admin.firestore.Timestamp.now();

//     // Helper: choose a numeric field on a counter doc to increment
//     function chooseNumericField(
//       counterData: FirebaseFirestore.DocumentData | undefined,
//     ) {
//       if (!counterData) return null;
//       const preferred = [
//         'available',
//         'remaining',
//         'count',
//         'qty',
//         'capacity',
//         'slots',
//         'seats',
//         'current',
//         'reserved',
//         'reservedCount',
//       ];
//       for (const p of preferred) {
//         if (typeof counterData[p] === 'number') return p;
//       }
//       // fallback: pick any numeric field
//       for (const k of Object.keys(counterData)) {
//         if (typeof counterData[k] === 'number') return k;
//       }
//       return null;
//     }

//     // Process one collection (orders/bookings)
//     async function processCollection(collectionPath: string) {
//       const batchSize = 300;
//       let lastSnapshotSize = 0;

//       // Query loop to handle many expired docs in pages
//       const queryBase = db
//         .collection(collectionPath)
//         .where('holdExpiresAt', '<=', now)
//         .orderBy('holdExpiresAt')
//         .limit(batchSize);

//       let query = queryBase;
//       while (true) {
//         const snap = await query.get();
//         if (snap.empty) break;

//         lastSnapshotSize = snap.size;
//         const promises = snap.docs.map(async doc => {
//           const docRef = doc.ref;

//           try {
//             await db.runTransaction(async tx => {
//               const fresh = await tx.get(docRef);
//               if (!fresh.exists) return;
//               const data = fresh.data() || {};

//               // Skip if already released
//               if (data.holdReleased) return;

//               const holdExpiresAt = data.holdExpiresAt as
//                 | admin.firestore.Timestamp
//                 | undefined;
//               if (!holdExpiresAt) return;
//               if (holdExpiresAt.toMillis() > now.toMillis()) return; // not yet expired

//               // Collect reservations: multiple shapes supported
//               const reservations: Array<any> =
//                 data.holdCounterReservations ||
//                 data.holdCounterDocIds ||
//                 data.holdCounterDocs ||
//                 [];

//               // If reservations is an object map, transform to array
//               const reservationsArray = Array.isArray(reservations)
//                 ? reservations
//                 : Object.keys(reservations).map(k => reservations[k]);

//               // Release each reservation by incrementing the best numeric field
//               for (const r of reservationsArray) {
//                 // normalize to path + amount
//                 let counterPath: string | null = null;
//                 let amount = 1;

//                 if (typeof r === 'string') {
//                   counterPath = r;
//                 } else if (typeof r === 'object' && r !== null) {
//                   counterPath =
//                     r.counterDocPath ||
//                     r.counterPath ||
//                     r.docPath ||
//                     r.path ||
//                     r.doc ||
//                     null;
//                   amount =
//                     Number(r.amount || r.qty || r.count || r.reserved || 1) ||
//                     1;
//                 }

//                 if (!counterPath) continue;
//                 const counterRef = db.doc(counterPath);

//                 // Read counter doc and pick a numeric field to increment
//                 const counterSnap = await tx.get(counterRef);
//                 if (!counterSnap.exists) {
//                   // nothing to restore
//                   continue;
//                 }
//                 const counterData = counterSnap.data();
//                 const numericField = chooseNumericField(counterData);

//                 if (numericField) {
//                   const update: any = {};
//                   update[numericField] =
//                     admin.firestore.FieldValue.increment(amount);
//                   tx.update(counterRef, update);
//                 } else {
//                   // If no numeric field found, increment `available` by default
//                   tx.update(counterRef, {
//                     available: admin.firestore.FieldValue.increment(amount),
//                   });
//                 }
//               }

//               // Mark doc as released and clear hold metadata (preserve audit trail)
//               const updates: any = {
//                 holdReleased: true,
//                 holdReleasedAt: admin.firestore.FieldValue.serverTimestamp(),
//                 holdReleasedBy: 'system',
//               };
//               // remove hold fields if present
//               if (data.holdExpiresAt !== undefined)
//                 updates['holdExpiresAt'] = admin.firestore.FieldValue.delete();
//               if (data.holdCounterReservations !== undefined)
//                 updates['holdCounterReservations'] =
//                   admin.firestore.FieldValue.delete();
//               if (data.holdCounterDocIds !== undefined)
//                 updates['holdCounterDocIds'] =
//                   admin.firestore.FieldValue.delete();
//               if (data.holdCounterDocs !== undefined)
//                 updates['holdCounterDocs'] =
//                   admin.firestore.FieldValue.delete();

//               // Optionally move status when it was a pending hold
//               if (
//                 data.status === 'pending' ||
//                 data.status === 'on_hold' ||
//                 data.status === 'hold'
//               ) {
//                 // For orders, mark as 'expired' so UI can show expired state
//                 if (collectionPath === 'orders') {
//                   updates['status'] = 'expired';
//                   updates['expiredAt'] =
//                     admin.firestore.FieldValue.serverTimestamp();
//                   // Create mandatory notifications for both client and vendor
//                   try {
//                     const clientId = data.clientId || data.client || null;
//                     const vendorId = data.vendorId || data.vendor || null;
//                     const publicCode = data.publicCode || '';
//                     const clientName =
//                       (data.clientInfo && (data.clientInfo.name || '')) ||
//                       data.clientName ||
//                       '';

//                     // Notification payload common fields
//                     const notifBase: any = {
//                       orderId: docRef.id,
//                       publicCode: publicCode,
//                       clientName: clientName,
//                       expired: true,
//                       expiryReason: 'hold_expired',
//                       createdAt: admin.firestore.FieldValue.serverTimestamp(),
//                       timestamp: admin.firestore.FieldValue.serverTimestamp(),
//                       read: false,
//                     };

//                     // Avoid creating duplicate expiry notifications when a
//                     // more-specific release job (e.g. pickup hold release)
//                     // already marked the order with an expiration reason/hold.
//                     const alreadyMarked =
//                       data.expirationReason ||
//                       data.expiryReason ||
//                       data.holdType;
//                     if (!alreadyMarked) {
//                       try {
//                         // Double-check: if a specialized expiry notification was
//                         // already created for this order (slot/serving types),
//                         // skip creating the generic `orderExpired` to avoid duplicates.
//                         const specializedTypes = [
//                           'order_expired_serving',
//                           'order_expired_slot',
//                         ];
//                         const existing = await db
//                           .collection('notifications')
//                           .where('orderId', '==', docRef.id)
//                           .where('type', 'in', specializedTypes)
//                           .limit(1)
//                           .get();

//                         if (!existing.empty) {
//                           console.log(
//                             `Skipping generic orderExpired for ${docRef.path} because specialized notification already exists`,
//                           );
//                         } else {
//                           if (clientId) {
//                             const clientNotifRef = db
//                               .collection('notifications')
//                               .doc();
//                             tx.set(clientNotifRef, {
//                               userId: clientId,
//                               type: 'orderExpired',
//                               ...notifBase,
//                             });
//                           }

//                           if (vendorId) {
//                             const vendorNotifRef = db
//                               .collection('notifications')
//                               .doc();
//                             tx.set(vendorNotifRef, {
//                               userId: vendorId,
//                               type: 'orderExpired',
//                               vendorId: vendorId,
//                               ...notifBase,
//                             });
//                           }
//                         }
//                       } catch (err) {
//                         console.error(
//                           'Error checking existing expiry notifications:',
//                           err,
//                         );
//                       }
//                     } else {
//                       console.log(
//                         `Skipping generic orderExpired for ${docRef.path} because specialized expiration exists`,
//                       );
//                     }
//                   } catch (err) {
//                     console.error(
//                       'Failed to create expiry notifications:',
//                       err,
//                     );
//                   }
//                 } else {
//                   // For other collections (bookings) keep previous behaviour
//                   updates['status'] = 'cancelled';
//                   updates['cancellationReason'] = 'hold_expired';
//                 }
//               }

//               tx.update(docRef, updates);
//             });
//           } catch (err) {
//             console.error(
//               `Failed to release hold for ${collectionPath}/${doc.id}:`,
//               err,
//             );
//           }
//         });

//         await Promise.all(promises);

//         // Prepare next page: startAfter last doc
//         const last = snap.docs[snap.docs.length - 1];
//         query = queryBase.startAfter(last);
//         if (snap.size < batchSize) break;
//       }
//       return lastSnapshotSize;
//     }

//     // Run for both collections
//     try {
//       const ordersProcessed = await processCollection('orders');
//       const bookingsProcessed = await processCollection('bookings');
//       console.log(
//         `[releaseExpiredHolds] processed orders:${ordersProcessed} bookings:${bookingsProcessed}`,
//       );
//     } catch (err) {
//       console.error('[releaseExpiredHolds] unexpected error:', err);
//     }

//     return null;
//   });

// // ============================================
// // BOOKING SYSTEM CLOUD FUNCTIONS
// // ============================================

// // Notify vendor when a new booking is created
// export const notifyVendorOnNewBooking = functions.firestore
//   .document('bookings/{bookingId}')
//   .onCreate(async (snap, context) => {
//     const booking = snap.data();
//     if (!booking) return null;

//     const vendorId = booking.vendorId;
//     const clientName = booking.clientInfo?.name
//       ? `${booking.clientInfo.name} ${booking.clientInfo.lastName || ''}`.trim()
//       : 'Client';
//     const bookingId = context.params.bookingId;
//     const publicCode = booking.publicCode || bookingId.slice(-6).toUpperCase();
//     const serviceType = booking.serviceType || 'table booking';

//     if (!vendorId) {
//       console.log('No vendor ID found for booking');
//       return null;
//     }

//     // Check user preferences before creating notification
//     const shouldSend = await shouldSendNotification(vendorId, 'newBooking');
//     if (!shouldSend) {
//       console.log(
//         `Skipping new booking notification for vendor ${vendorId} - disabled in preferences`,
//       );
//       return null;
//     }

//     try {
//       // Use NotificationService function for proper formatting
//       await admin.firestore().collection('notifications').add({
//         userId: vendorId,
//         bookingId: bookingId,
//         publicCode: publicCode,
//         clientName: clientName,
//         serviceType: serviceType,
//         type: 'newBooking',
//         archived: false,
//         // Let client/localized UI render title/body from `type` + payload
//         message: '',
//         createdAt: new Date().toISOString(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       });

//       console.log(
//         `New booking notification created for vendor ${vendorId}, booking ${bookingId}`,
//       );
//     } catch (error) {
//       console.error('Error creating new booking notification:', error);
//     }

//     return null;
//   });

// // Notify client when booking status changes
// export const notifyClientOnBookingStatusChange = functions.firestore
//   .document('bookings/{bookingId}')
//   .onUpdate(async (change, context) => {
//     const before = change.before.data();
//     const after = change.after.data();

//     // Only proceed if status actually changed
//     if (before.status === after.status) {
//       return null;
//     }

//     const clientId = after.clientId;
//     const bookingId = context.params.bookingId;

//     if (!clientId) {
//       console.log('No client ID found for booking');
//       return null;
//     }

//     // Determine notification type based on new status
//     let notificationType = '';

//     switch (after.status) {
//       case 'accepted':
//         notificationType = 'bookingAccepted';
//         break;
//       case 'rejected':
//         notificationType = 'bookingRejected';
//         break;
//       case 'cancelled':
//         notificationType = 'bookingCancelled';
//         break;
//       case 'expired':
//         notificationType = 'bookingExpired';
//         break;
//       case 'completed':
//         notificationType = 'bookingCompleted';
//         break;
//       default:
//         console.log(
//           `No notification needed for booking status: ${after.status}`,
//         );
//         return null;
//     }

//     // Expiry notifications are mandatory and should not be filtered by preferences
//     let shouldProceed = true;
//     if (notificationType !== 'bookingExpired') {
//       const shouldSend = await shouldSendNotification(
//         clientId,
//         notificationType,
//       );
//       if (!shouldSend) {
//         console.log(
//           `Skipping ${notificationType} notification for client ${clientId} - disabled in preferences`,
//         );
//         shouldProceed = false;
//       }
//     }
//     if (!shouldProceed) return null;

//     try {
//       const publicCode = after.publicCode || bookingId.slice(-6).toUpperCase();
//       const date = after.date || '';
//       const mealTime = after.mealTime || '';

//       // Create notification data based on type
//       let notificationData: any = {
//         userId: clientId,
//         bookingId: bookingId,
//         publicCode: publicCode,
//         type: notificationType,
//         archived: false,
//         createdAt: new Date().toISOString(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       };

//       // Add type-specific data and message
//       switch (notificationType) {
//         case 'bookingAccepted':
//           notificationData.deliveryDate = date;
//           notificationData.mealTime = mealTime;
//           break;
//         case 'bookingRejected':
//           notificationData.rejectionReason =
//             after.rejectionReason || 'No reason provided';
//           notificationData.message = '';
//           break;
//         case 'bookingCancelled':
//           notificationData.cancellationReason =
//             after.cancellationReason || 'No reason provided';
//           break;
//         case 'bookingExpired':
//           // mandatory dynamic expiry payload (client and vendor will localize)
//           notificationData.expired = true;
//           notificationData.expiredAt =
//             admin.firestore.FieldValue.serverTimestamp();
//           notificationData.expiryReason = after.expiryReason || 'hold_expired';
//           break;
//         default:
//           notificationData.message = `Your booking ${publicCode} status changed to ${after.status}`;
//       }

//       // Create notification for client
//       await admin.firestore().collection('notifications').add(notificationData);

//       // Also create a mandatory vendor notification for expiry events
//       if (notificationType === 'bookingExpired') {
//         try {
//           const vendorId = after.vendorId || after.vendor || null;
//           if (vendorId) {
//             const vendorNotif: any = {
//               userId: vendorId,
//               type: 'bookingExpired',
//               bookingId: bookingId,
//               publicCode: publicCode,
//               clientName: after.clientInfo?.name || after.clientName || '',
//               expired: true,
//               expiredAt: admin.firestore.FieldValue.serverTimestamp(),
//               expiryReason: after.expiryReason || 'hold_expired',
//               createdAt: admin.firestore.FieldValue.serverTimestamp(),
//               timestamp: admin.firestore.FieldValue.serverTimestamp(),
//               read: false,
//             };
//             await admin
//               .firestore()
//               .collection('notifications')
//               .add(vendorNotif);
//           }
//         } catch (err) {
//           console.error(
//             'Failed to create vendor bookingExpired notification:',
//             err,
//           );
//         }
//       }

//       console.log(
//         `${notificationType} notification created for client ${clientId}, booking ${bookingId}`,
//       );
//     } catch (error) {
//       console.error(`Error creating ${notificationType} notification:`, error);
//     }

//     return null;
//   });

// // Notify client when their booking is cancelled due to order conflict
// export const notifyClientOnBookingCancellation = functions.firestore
//   .document('bookings/{bookingId}')
//   .onUpdate(async (change, context) => {
//     const before = change.before.data();
//     const after = change.after.data();

//     // Only proceed if booking was cancelled due to conflict
//     if (
//       before.status !== 'cancelled' &&
//       after.status === 'cancelled' &&
//       after.cancellationReason === 'order_conflict'
//     ) {
//       const clientId = after.clientId;
//       const bookingId = context.params.bookingId;

//       if (!clientId) return null;

//       // Check user preferences
//       const shouldSend = await shouldSendNotification(
//         clientId,
//         'bookingConflictCancellation',
//       );
//       if (!shouldSend) {
//         console.log(
//           `Skipping booking conflict notification for client ${clientId} - disabled in preferences`,
//         );
//         return null;
//       }

//       try {
//         await admin
//           .firestore()
//           .collection('notifications')
//           .add({
//             userId: clientId,
//             type: 'bookingConflictCancellation',
//             bookingId: bookingId,
//             bookingDate: after.date,
//             tableNumber: after.tableNumber,
//             vendorId: after.vendorId,
//             conflictOrderId: after.conflictOrderId || null,
//             createdAt: admin.firestore.FieldValue.serverTimestamp(),
//             timestamp: admin.firestore.FieldValue.serverTimestamp(),
//             read: false,
//           });

//         console.log(
//           `Booking conflict cancellation notification created for client ${clientId}`,
//         );
//       } catch (error) {
//         console.error('Error creating booking conflict notification:', error);
//       }
//     }

//     return null;
//   });

// // Update booking statistics when booking status changes
// export const updateBookingStatistics = functions.firestore
//   .document('bookings/{bookingId}')
//   .onWrite(async (change, context) => {
//     console.log('Booking statistics update triggered!');

//     const beforeData = change.before.exists ? change.before.data() : null;
//     const afterData = change.after.exists ? change.after.data() : null;

//     // Only process if status changed
//     const beforeStatus = beforeData?.status;
//     const afterStatus = afterData?.status;

//     if (beforeStatus === afterStatus) {
//       return null;
//     }

//     // Use vendorId from afterData if exists, else from beforeData (for deletions)
//     const vendorId = afterData ? afterData.vendorId : beforeData?.vendorId;
//     if (!vendorId) {
//       console.log('No vendor ID found for booking');
//       return null;
//     }

//     try {
//       const vendorRef = admin.firestore().collection('users').doc(vendorId);
//       const vendorDoc = await vendorRef.get();
//       const vendorData = vendorDoc.data();

//       if (!vendorData) {
//         console.log('Vendor not found');
//         return null;
//       }

//       // Initialize booking statistics if they don't exist
//       const bookingStats = vendorData.bookingStatistics || {
//         totalBookings: 0,
//         acceptedBookings: 0,
//         completedBookings: 0,
//         cancelledBookings: 0,
//         rejectedBookings: 0,
//         expiredBookings: 0,
//       };

//       // Handle booking deletion
//       if (!afterData) {
//         if (beforeStatus === 'accepted') {
//           bookingStats.acceptedBookings = Math.max(
//             0,
//             (bookingStats.acceptedBookings || 0) - 1,
//           );
//         }
//         if (beforeStatus === 'completed') {
//           bookingStats.completedBookings = Math.max(
//             0,
//             (bookingStats.completedBookings || 0) - 1,
//           );
//         }
//         if (beforeStatus === 'cancelled') {
//           bookingStats.cancelledBookings = Math.max(
//             0,
//             (bookingStats.cancelledBookings || 0) - 1,
//           );
//         }
//         if (beforeStatus === 'rejected') {
//           bookingStats.rejectedBookings = Math.max(
//             0,
//             (bookingStats.rejectedBookings || 0) - 1,
//           );
//         }
//         if (beforeStatus === 'expired') {
//           bookingStats.expiredBookings = Math.max(
//             0,
//             (bookingStats.expiredBookings || 0) - 1,
//           );
//         }
//         bookingStats.totalBookings = Math.max(
//           0,
//           (bookingStats.totalBookings || 0) - 1,
//         );

//         await vendorRef.update({
//           bookingStatistics: bookingStats,
//           lastBookingUpdate: admin.firestore.FieldValue.serverTimestamp(),
//         });
//         return null;
//       }

//       // Status transitions for new bookings
//       if (!beforeData) {
//         bookingStats.totalBookings = (bookingStats.totalBookings || 0) + 1;
//         if (afterStatus === 'expired') {
//           bookingStats.expiredBookings =
//             (bookingStats.expiredBookings || 0) + 1;
//         }
//       }

//       // Handle status changes
//       if (afterStatus === 'accepted' && beforeStatus !== 'accepted') {
//         bookingStats.acceptedBookings =
//           (bookingStats.acceptedBookings || 0) + 1;
//       }
//       if (afterStatus === 'completed' && beforeStatus !== 'completed') {
//         bookingStats.completedBookings =
//           (bookingStats.completedBookings || 0) + 1;
//       }
//       if (afterStatus === 'cancelled' && beforeStatus !== 'cancelled') {
//         bookingStats.cancelledBookings =
//           (bookingStats.cancelledBookings || 0) + 1;
//       }
//       if (afterStatus === 'rejected' && beforeStatus !== 'rejected') {
//         bookingStats.rejectedBookings =
//           (bookingStats.rejectedBookings || 0) + 1;
//       }
//       if (afterStatus === 'expired' && beforeStatus !== 'expired') {
//         bookingStats.expiredBookings = (bookingStats.expiredBookings || 0) + 1;
//       }

//       // Handle status reversions
//       if (beforeStatus === 'accepted' && afterStatus !== 'accepted') {
//         bookingStats.acceptedBookings = Math.max(
//           0,
//           (bookingStats.acceptedBookings || 0) - 1,
//         );
//       }
//       if (beforeStatus === 'completed' && afterStatus !== 'completed') {
//         bookingStats.completedBookings = Math.max(
//           0,
//           (bookingStats.completedBookings || 0) - 1,
//         );
//       }
//       if (beforeStatus === 'cancelled' && afterStatus !== 'cancelled') {
//         bookingStats.cancelledBookings = Math.max(
//           0,
//           (bookingStats.cancelledBookings || 0) - 1,
//         );
//       }
//       if (beforeStatus === 'rejected' && afterStatus !== 'rejected') {
//         bookingStats.rejectedBookings = Math.max(
//           0,
//           (bookingStats.rejectedBookings || 0) - 1,
//         );
//       }
//       if (beforeStatus === 'expired' && afterStatus !== 'expired') {
//         bookingStats.expiredBookings = Math.max(
//           0,
//           (bookingStats.expiredBookings || 0) - 1,
//         );
//       }

//       await vendorRef.update({
//         bookingStatistics: bookingStats,
//         lastBookingUpdate: admin.firestore.FieldValue.serverTimestamp(),
//       });

//       console.log(
//         `Updated vendor ${vendorId} booking statistics:`,
//         bookingStats,
//       );
//     } catch (error) {
//       console.error('Error updating booking statistics:', error);
//     }

//     return null;
//   });

// // Notify clients of upcoming bookings (runs daily at 8 AM)
// export const notifyClientsOfUpcomingBookings = functions.pubsub
//   .schedule('every day 08:00')
//   .timeZone('UTC')
//   .onRun(async _context => {
//     const db = admin.firestore();
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);
//     const tomorrow = new Date(today);
//     tomorrow.setDate(today.getDate() + 1);

//     // Query bookings for tomorrow with status accepted
//     const bookingsSnap = await db
//       .collection('bookings')
//       .where('date', '>=', today.toISOString())
//       .where('date', '<=', tomorrow.toISOString())
//       .where('status', '==', 'accepted')
//       .get();

//     if (bookingsSnap.empty) {
//       console.log('No upcoming bookings found.');
//       return null;
//     }

//     const notifications: any[] = [];

//     for (const doc of bookingsSnap.docs) {
//       const booking = doc.data();
//       const clientId = booking.clientId;
//       if (!clientId) continue;

//       // Check if a reminder notification already exists
//       const existing = await db
//         .collection('notifications')
//         .where('userId', '==', clientId)
//         .where('type', '==', 'bookingReminder')
//         .where('bookingId', '==', doc.id)
//         .get();
//       if (!existing.empty) continue;

//       // Check user preferences
//       const shouldSend = await shouldSendNotification(
//         clientId,
//         'bookingReminder',
//       );
//       if (!shouldSend) continue;

//       notifications.push({
//         userId: clientId,
//         type: 'bookingReminder',
//         bookingId: doc.id,
//         bookingDate: booking.date,
//         tableNumber: booking.tableNumber,
//         numberOfGuests: booking.numberOfGuests,
//         vendorId: booking.vendorId,
//         createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       });
//     }

//     // Batch create notifications
//     if (notifications.length > 0) {
//       const batch = db.batch();
//       notifications.forEach(notif => {
//         const ref = db.collection('notifications').doc();
//         batch.set(ref, notif);
//       });
//       await batch.commit();
//       console.log(
//         `Created ${notifications.length} booking reminder notifications.`,
//       );
//     }

//     return null;
//   });

// // Notify vendors of upcoming bookings (runs daily at 8 AM)
// export const notifyVendorsOfUpcomingBookings = functions.pubsub
//   .schedule('every day 08:00')
//   .timeZone('UTC')
//   .onRun(async _context => {
//     const db = admin.firestore();
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);
//     const tomorrow = new Date(today);
//     tomorrow.setDate(today.getDate() + 1);

//     // Query bookings for tomorrow with status accepted
//     const bookingsSnap = await db
//       .collection('bookings')
//       .where('date', '>=', today.toISOString())
//       .where('date', '<=', tomorrow.toISOString())
//       .where('status', '==', 'accepted')
//       .get();

//     if (bookingsSnap.empty) {
//       console.log('No upcoming vendor bookings found.');
//       return null;
//     }

//     // Group bookings by vendor
//     const vendorBookings: {[vendorId: string]: any[]} = {};

//     bookingsSnap.docs.forEach(doc => {
//       const booking = doc.data();
//       const vendorId = booking.vendorId;
//       if (vendorId) {
//         if (!vendorBookings[vendorId]) {
//           vendorBookings[vendorId] = [];
//         }
//         vendorBookings[vendorId].push({id: doc.id, ...booking});
//       }
//     });

//     const notifications: any[] = [];

//     for (const [vendorId, bookings] of Object.entries(vendorBookings)) {
//       // Check if a reminder notification already exists for this vendor today
//       const existing = await db
//         .collection('notifications')
//         .where('userId', '==', vendorId)
//         .where('type', '==', 'vendorBookingReminder')
//         .where('timestamp', '>=', today)
//         .get();
//       if (!existing.empty) continue;

//       // Check user preferences
//       const shouldSend = await shouldSendNotification(
//         vendorId,
//         'vendorBookingReminder',
//       );
//       if (!shouldSend) continue;

//       notifications.push({
//         userId: vendorId,
//         type: 'vendorBookingReminder',
//         bookingCount: bookings.length,
//         bookingIds: bookings.map(b => b.id),
//         bookingDate: bookings[0].date,
//         createdAt: admin.firestore.FieldValue.serverTimestamp(),
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         read: false,
//       });
//     }

//     // Batch create notifications
//     if (notifications.length > 0) {
//       const batch = db.batch();
//       notifications.forEach(notif => {
//         const ref = db.collection('notifications').doc();
//         batch.set(ref, notif);
//       });
//       await batch.commit();
//       console.log(
//         `Created ${notifications.length} vendor booking reminder notifications.`,
//       );
//     }

//     return null;
//   });

// // Auto-complete bookings that have passed their date (runs daily at midnight)
// export const autoCompleteExpiredBookings = functions.pubsub
//   .schedule('0 0 * * *')
//   .timeZone('UTC')
//   .onRun(async _context => {
//     console.log('Auto-completing expired bookings...');

//     const db = admin.firestore();
//     const now = new Date();
//     const yesterday = new Date(now);
//     yesterday.setDate(now.getDate() - 1);
//     yesterday.setHours(23, 59, 59, 999);

//     try {
//       // Find accepted bookings that are past their date
//       const expiredBookingsQuery = db
//         .collection('bookings')
//         .where('status', '==', 'accepted')
//         .where('date', '<=', yesterday.toISOString())
//         .limit(500); // Process in batches

//       const snapshot = await expiredBookingsQuery.get();

//       if (snapshot.empty) {
//         console.log('No expired bookings to complete');
//         return;
//       }

//       const batch = db.batch();
//       let count = 0;

//       snapshot.forEach(doc => {
//         batch.update(doc.ref, {
//           status: 'completed',
//           completedAt: admin.firestore.FieldValue.serverTimestamp(),
//           completedReason: 'auto_completed_expired',
//         });
//         count++;
//       });

//       await batch.commit();
//       console.log(`Auto-completed ${count} expired bookings`);

//       // Create notifications for clients to review their completed bookings
//       const reviewNotifications: any[] = [];
//       for (const doc of snapshot.docs) {
//         const booking = doc.data();
//         const clientId = booking.clientId;
//         const vendorId = booking.vendorId;

//         if (clientId && vendorId) {
//           // Check user preferences
//           const shouldSend = await shouldSendNotification(
//             clientId,
//             'request_booking_review',
//           );
//           if (shouldSend) {
//             reviewNotifications.push({
//               userId: clientId,
//               type: 'request_booking_review',
//               bookingId: doc.id,
//               vendorId: vendorId,
//               createdAt: admin.firestore.FieldValue.serverTimestamp(),
//               timestamp: admin.firestore.FieldValue.serverTimestamp(),
//               read: false,
//             });
//           }
//         }
//       }

//       // Batch create review notifications
//       if (reviewNotifications.length > 0) {
//         const reviewBatch = db.batch();
//         reviewNotifications.forEach(notif => {
//           const ref = db.collection('notifications').doc();
//           reviewBatch.set(ref, notif);
//         });
//         await reviewBatch.commit();
//         console.log(
//           `Created ${reviewNotifications.length} booking review notifications`,
//         );
//       }
//     } catch (error) {
//       console.error('Error auto-completing expired bookings:', error);
//     }

//     return null;
//   });

// // Clean up old completed bookings (runs weekly on Sundays at 3 AM)
// export const cleanupOldBookings = functions.pubsub
//   .schedule('0 3 * * 0')
//   .timeZone('UTC')
//   .onRun(async _context => {
//     console.log('Cleaning up old bookings...');

//     const db = admin.firestore();
//     const sixtyDaysAgo = new Date();
//     sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

//     try {
//       const oldBookingsQuery = db
//         .collection('bookings')
//         .where('status', 'in', ['completed', 'cancelled', 'rejected'])
//         .where('date', '<', sixtyDaysAgo.toISOString())
//         .limit(500); // Process in batches

//       const snapshot = await oldBookingsQuery.get();

//       if (snapshot.empty) {
//         console.log('No old bookings to clean up');
//         return;
//       }

//       const batch = db.batch();
//       let count = 0;

//       snapshot.forEach(doc => {
//         batch.delete(doc.ref);
//         count++;
//       });

//       await batch.commit();
//       console.log(`Deleted ${count} old bookings`);
//     } catch (error) {
//       console.error('Error cleaning up old bookings:', error);
//     }

//     return null;
//   });

// // Notify client to review booking after completion
// export const notifyClientToReviewBooking = functions.firestore
//   .document('bookings/{bookingId}')
//   .onUpdate(async (change, context) => {
//     const before = change.before.data();
//     const after = change.after.data();

//     // Only proceed if status changed to 'completed'
//     if (before.status === after.status || after.status !== 'completed') {
//       return null;
//     }

//     // Get clientId and vendorId
//     const clientId = after.clientId;
//     const vendorId = after.vendorId;
//     if (!clientId || !vendorId) return null;

//     // Check user preferences
//     const shouldSend = await shouldSendNotification(
//       clientId,
//       'request_booking_review',
//     );
//     if (!shouldSend) {
//       console.log(
//         `Skipping request_booking_review notification for client ${clientId} - disabled in preferences`,
//       );
//       return null;
//     }

//     // Create a notification for the client to review the booking
//     await admin.firestore().collection('notifications').add({
//       userId: clientId,
//       type: 'request_booking_review',
//       vendorId: vendorId,
//       bookingId: context.params.bookingId,
//       bookingDate: after.date,
//       tableNumber: after.tableNumber,
//       createdAt: admin.firestore.FieldValue.serverTimestamp(),
//       timestamp: admin.firestore.FieldValue.serverTimestamp(),
//       read: false,
//     });

//     console.log(`Created booking review request for client ${clientId}`);
//     return null;
//   });

// // Update notification preferences to include booking-related notifications
// export const updateNotificationPreferencesForBookings = functions.https.onCall(
//   async (data, context) => {
//     if (!context.auth) {
//       throw new functions.https.HttpsError(
//         'unauthenticated',
//         'User must be authenticated',
//       );
//     }

//     const userId = context.auth.uid;
//     const {bookingNotifications = true} = data;

//     try {
//       await admin.firestore().collection('users').doc(userId).update({
//         'notificationPreferences.newBooking': bookingNotifications,
//         'notificationPreferences.bookingAccepted': bookingNotifications,
//         'notificationPreferences.bookingRejected': bookingNotifications,
//         'notificationPreferences.bookingCancelled': bookingNotifications,
//         'notificationPreferences.bookingCompleted': bookingNotifications,
//         'notificationPreferences.bookingReminder': bookingNotifications,
//         'notificationPreferences.vendorBookingReminder': bookingNotifications,
//         'notificationPreferences.bookingConflictCancellation':
//           bookingNotifications,
//         'notificationPreferences.request_booking_review': bookingNotifications,
//       });

//       return {success: true};
//     } catch (error) {
//       console.error('Error updating booking notification preferences:', error);
//       throw new functions.https.HttpsError(
//         'internal',
//         'Failed to update notification preferences',
//       );
//     }
//   },
// );

// // Release expired pickup slot holds and cancel pending orders
// export const releaseExpiredPickupHolds = functions.pubsub
//   .schedule('every 1 minutes')
//   .timeZone('UTC')
//   .onRun(async () => {
//     try {
//       const nowTs = admin.firestore.Timestamp.now();
//       console.log(
//         `🔄 Checking for expired pickup holds at ${nowTs
//           .toDate()
//           .toISOString()}`,
//       );

//       // Find expired holds (compare Timestamps)
//       const expiredHoldsQuery = await admin
//         .firestore()
//         .collection('pickupSlotHolds')
//         .where('status', '==', 'active')
//         .where('holdExpiresAt', '<=', nowTs)
//         .get();

//       if (expiredHoldsQuery.empty) {
//         console.log('✅ No expired pickup holds found');
//         return null;
//       }

//       console.log(`🔍 Found ${expiredHoldsQuery.size} expired pickup holds`);

//       const batch = admin.firestore().batch();
//       let releasedCount = 0;
//       let expiredOrdersCount = 0;

//       for (const holdDoc of expiredHoldsQuery.docs) {
//         const hold = holdDoc.data();

//         // Mark hold as expired
//         batch.update(holdDoc.ref, {
//           status: 'expired',
//           expiredAt: admin.firestore.FieldValue.serverTimestamp(),
//         });

//         // Find and cancel pending orders that were holding this slot or serving
//         let pendingOrdersQuery: FirebaseFirestore.QuerySnapshot | null = null;

//         if (hold.slotTime) {
//           // slot-based holds: match by pickupTimeSlot + date
//           pendingOrdersQuery = await admin
//             .firestore()
//             .collection('orders')
//             .where('status', '==', 'pending')
//             .where('deliveryMethod', '==', 'pickup')
//             .where('pickupTimeSlot', '==', hold.slotTime)
//             .where('selectedDate', '==', hold.date)
//             .get();
//         } else {
//           // serving-based holds: match pending pickup orders on the date
//           // optionally filter by mealTime if present on the hold
//           // For serving-based holds we must consider orders regardless of deliveryMethod
//           // (servings apply across pickup and delivery). Do not filter by deliveryMethod here.
//           let q: FirebaseFirestore.Query = admin
//             .firestore()
//             .collection('orders')
//             .where('status', '==', 'pending')
//             .where('selectedDate', '==', hold.date);

//           if (hold.mealTime) {
//             q = q.where('selectedMealTime', '==', hold.mealTime);
//           }

//           pendingOrdersQuery = await q.get();
//         }

//         // Cancel the pending orders (if any)
//         if (pendingOrdersQuery && !pendingOrdersQuery.empty) {
//           for (const orderDoc of pendingOrdersQuery.docs) {
//             const order = orderDoc.data();

//             // Check if this order contains the food item from the hold
//             const hasMatchingItem = order.items?.some(
//               (item: any) =>
//                 item.itemId === hold.foodItemId ||
//                 item.foodItemId === hold.foodItemId,
//             );

//             if (hasMatchingItem) {
//               batch.update(orderDoc.ref, {
//                 status: 'expired',
//                 // Use a code-style expiration reason so clients can localize
//                 expirationReason: hold.slotTime
//                   ? 'slot_hold_expired'
//                   : 'serving_hold_expired',
//                 // Also write preferred `expiryReason` for consistency with notifications
//                 expiryReason: hold.slotTime
//                   ? 'slot_hold_expired'
//                   : 'serving_hold_expired',
//                 expiredAt: admin.firestore.FieldValue.serverTimestamp(),
//                 updatedAt: admin.firestore.FieldValue.serverTimestamp(),
//               });
//               expiredOrdersCount++;
//               // Client notification for expired orders is handled by the
//               // central expiry flow elsewhere; do not create a duplicate
//               // hold-specific notification here.

//               // Create a vendor-facing notification so vendors are informed
//               // when an order they were holding expires.
//               try {
//                 if (order.vendorId) {
//                   const vendorNotifRef = admin
//                     .firestore()
//                     .collection('notifications')
//                     .doc();
//                   batch.set(vendorNotifRef, {
//                     userId: order.vendorId,
//                     vendorId: order.vendorId,
//                     orderId: orderDoc.id,
//                     publicCode: order.publicCode || '',
//                     type: 'orderExpired',
//                     expired: true,
//                     expiryReason: hold.slotTime
//                       ? 'slot_hold_expired'
//                       : 'serving_hold_expired',
//                     expiredAt: admin.firestore.FieldValue.serverTimestamp(),
//                     message: '',
//                     createdAt: admin.firestore.FieldValue.serverTimestamp(),
//                     timestamp: admin.firestore.FieldValue.serverTimestamp(),
//                     read: false,
//                     role: 'vendor',
//                   });
//                 }
//               } catch (err) {
//                 // Keep hold release best-effort; log and continue
//                 console.error('Error queuing vendor expiry notification:', err);
//               }
//             }
//           }
//         }

//         releasedCount++;
//       }

//       // Commit all changes
//       await batch.commit();

//       console.log(
//         `✅ Released ${releasedCount} expired pickup holds and expired ${expiredOrdersCount} orders`,
//       );

//       return {
//         releasedHolds: releasedCount,
//         expiredOrders: expiredOrdersCount,
//         timestamp: nowTs.toDate().toISOString(),
//       };
//     } catch (error) {
//       console.error('❌ Error in releaseExpiredPickupHolds:', error);
//       throw error;
//     }
//   });

// // Release expired booking holds and expire related pending bookings
// export const releaseExpiredBookingHolds = functions.pubsub
//   .schedule('every 1 minutes')
//   .timeZone('UTC')
//   .onRun(async () => {
//     const db = admin.firestore();
//     const now = admin.firestore.Timestamp.now();

//     try {
//       console.log(
//         `🔄 Checking for expired booking holds at ${now
//           .toDate()
//           .toISOString()}`,
//       );

//       // Find expired booking holds (compare Timestamps)
//       const expiredHoldsQuery = await db
//         .collection('bookingHolds')
//         .where('status', '==', 'active')
//         .where('holdExpiresAt', '<=', now)
//         .get();

//       if (expiredHoldsQuery.empty) {
//         console.log('✅ No expired booking holds found');
//         return null;
//       }

//       console.log(`🔍 Found ${expiredHoldsQuery.size} expired booking holds`);

//       const batch = db.batch();
//       let releasedCount = 0;
//       let expiredBookingsCount = 0;

//       for (const holdDoc of expiredHoldsQuery.docs) {
//         const hold = holdDoc.data();

//         // Mark hold as released
//         batch.update(holdDoc.ref, {
//           status: 'released',
//           releasedAt: admin.firestore.FieldValue.serverTimestamp(),
//         });

//         // If hold directly references a bookingId, expire that booking when still pending
//         const bookingId = hold?.bookingId;
//         if (bookingId) {
//           const bookingRef = db.collection('bookings').doc(bookingId);
//           const bookingSnap = await bookingRef.get();
//           if (bookingSnap.exists) {
//             const booking = bookingSnap.data();
//             if (booking && booking.status === 'pending') {
//               batch.update(bookingRef, {
//                 status: 'expired',
//                 expiredAt: admin.firestore.FieldValue.serverTimestamp(),
//                 updatedAt: admin.firestore.FieldValue.serverTimestamp(),
//                 cancellationReason: 'booking_hold_expired',
//               });
//               expiredBookingsCount++;

//               // Notify client about expiration
//               if (booking.clientId) {
//                 const notifRef = db.collection('notifications').doc();
//                 batch.set(notifRef, {
//                   userId: booking.clientId,
//                   type: 'bookingExpired',
//                   bookingId: bookingId,
//                   publicCode: booking.publicCode || '',
//                   clientName:
//                     booking.clientInfo?.name || booking.clientName || '',
//                   expired: true,
//                   expiryReason: 'booking_hold_expired',
//                   expiredAt: admin.firestore.FieldValue.serverTimestamp(),
//                   message: '',
//                   createdAt: admin.firestore.FieldValue.serverTimestamp(),
//                   timestamp: admin.firestore.FieldValue.serverTimestamp(),
//                   read: false,
//                 });
//               }
//             }
//           }
//         } else {
//           // Fallback: find bookings that reference this hold via bookingHoldId
//           const q = await db
//             .collection('bookings')
//             .where('bookingHoldId', '==', holdDoc.id)
//             .get();
//           if (!q.empty) {
//             for (const bdoc of q.docs) {
//               const booking = bdoc.data();
//               if (booking && booking.status === 'pending') {
//                 batch.update(bdoc.ref, {
//                   status: 'expired',
//                   expiredAt: admin.firestore.FieldValue.serverTimestamp(),
//                   updatedAt: admin.firestore.FieldValue.serverTimestamp(),
//                   cancellationReason: 'booking_hold_expired',
//                 });
//                 expiredBookingsCount++;

//                 if (booking.clientId) {
//                   const notifRef = db.collection('notifications').doc();
//                   batch.set(notifRef, {
//                     userId: booking.clientId,
//                     type: 'bookingExpired',
//                     bookingId: bdoc.id,
//                     publicCode: booking.publicCode || '',
//                     clientName:
//                       booking.clientInfo?.name || booking.clientName || '',
//                     expired: true,
//                     expiryReason: 'booking_hold_expired',
//                     expiredAt: admin.firestore.FieldValue.serverTimestamp(),
//                     message: '',
//                     createdAt: admin.firestore.FieldValue.serverTimestamp(),
//                     timestamp: admin.firestore.FieldValue.serverTimestamp(),
//                     read: false,
//                   });
//                 }
//               }
//             }
//           }
//         }

//         releasedCount++;
//       }

//       // Commit batched updates
//       await batch.commit();

//       console.log(
//         `✅ Released ${releasedCount} booking holds and expired ${expiredBookingsCount} bookings`,
//       );

//       return {
//         releasedHolds: releasedCount,
//         expiredBookings: expiredBookingsCount,
//         timestamp: now.toDate().toISOString(),
//       };
//     } catch (error) {
//       console.error('❌ Error in releaseExpiredBookingHolds:', error);
//       throw error;
//     }
//   });




//version 3 best version
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import {defineSecret} from 'firebase-functions/params';
const nodemailer = require('nodemailer');

const GMAIL_EMAIL = defineSecret('GMAIL_EMAIL');
const GMAIL_PASSWORD = defineSecret('GMAIL_PASSWORD');
const MAILERSEND_API_KEY = defineSecret('MAILERSEND_API_KEY');

admin.initializeApp();

async function shouldSendNotification(
  userId: string,
  notificationType: string | number,
) {
  try {
    // ✅ MANDATORY NOTIFICATIONS - Always send these
    const mandatoryNotifications = [
      'orderAccepted',
      'orderRejected',
      'orderDelivered',
      'orderExpired',
      'newOrder',
      'referral',
      'referral_pending',
      // Booking mandatory notifications
      'newBooking',
      'bookingAccepted',
      'bookingRejected',
      'bookingCancelled',
      'bookingExpired',
      'bookingConflictCancellation',
    ];

    // Always send mandatory notifications
    if (mandatoryNotifications.includes(notificationType as string)) {
      console.log(`Sending mandatory notification: ${notificationType}`);
      return true;
    }

    // For optional notifications, check user preferences
    const userDoc = await admin
      .firestore()
      .collection('users')
      .doc(userId)
      .get();
    const preferences = userDoc.data()?.notificationPreferences;

    if (!preferences) return true; // Default to send if no preferences

    // Check global push notifications setting
    if (!preferences.pushNotifications) return false;

    // ✅ Map notification types to preference keys
    const typeMapping: {[key: string]: string} = {
      request_vendor_review: 'requestVendorReview',
      new_review: 'newReview',
      review_update: 'reviewUpdate',
      review_deleted: 'reviewDeleted',
      vendor_response: 'vendorResponse',
      chat_message: 'chatMessage',
      // ✅ Add these missing mappings
      chatMessage: 'chatMessage',
      requestVendorReview: 'requestVendorReview',
      // ✅ Booking notification mappings
      bookingCompleted: 'bookingCompleted',
      bookingReminder: 'bookingReminder',
      vendorBookingReminder: 'vendorBookingReminder',
      request_booking_review: 'requestBookingReview',
    };

    // Get the preference key to check
    const preferenceKey =
      typeMapping[notificationType as string] || notificationType;

    // Check specific notification type
    return preferences[preferenceKey] !== false;
  } catch (error) {
    console.error('Error checking notification preferences:', error);
    return true; // Default to send on error
  }
}

// Centralized push sender that computes unread badge and cleans invalid tokens
async function sendPushWithBadge(
  userId: string,
  basePayload: Partial<admin.messaging.Message>,
) {
  try {
    const userRef = admin.firestore().collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return null;

    // Support both fcmToken (string) and fcmTokens (array)
    const rawTokens = userDoc.get('fcmTokens') || userDoc.get('fcmToken') || [];
    let tokens: string[] = [];
    if (Array.isArray(rawTokens)) tokens = rawTokens.filter(Boolean);
    else if (typeof rawTokens === 'string' && rawTokens) tokens = [rawTokens];
    if (!tokens.length) return null;

    // Log tokens and environment to help debug routing/proxy issues
    // tokens and environment information intentionally not logged in production

    // Compute unread count excluding chat messages (match client-side behavior)
    const unreadSnap = await admin
      .firestore()
      .collection('notifications')
      .where('userId', '==', userId)
      .where('read', '==', false)
      .get();
    const unreadCount = unreadSnap.docs.filter(
      d => d.data()?.type !== 'chat_message',
    ).length;

    // Debug: log the computed unread count so we can verify the APNs badge value
    // computed unreadCount is used to set the APNs badge

    // Build apns payload with computed badge (preserve other aps fields if provided)
    const apnsFromBase =
      basePayload.apns && (basePayload.apns as any).payload
        ? JSON.parse(JSON.stringify((basePayload.apns as any).payload))
        : {aps: {}};
    apnsFromBase.aps = apnsFromBase.aps || {};
    apnsFromBase.aps.badge = unreadCount;
    // Debug: log final APNs payload so we can confirm the exact `aps` sent
    // final APNs payload prepared (not logged in production)
    // Ensure sound/alert stay if provided in basePayload
    const apns = {payload: apnsFromBase} as any;

    // Compose multicast message
    const multicast: admin.messaging.MulticastMessage = {
      tokens,
      notification: basePayload.notification,
      data: basePayload.data,
      android: basePayload.android,
      apns,
    };

    let response: any = null;
    try {
      response = await admin.messaging().sendMulticast(multicast);
    } catch (sendErr: any) {
      // Multicast failed; fall back to sending to each token individually
      const perResults: Array<{success: boolean; error?: any; token: string}> =
        [];
      for (const t of tokens) {
        try {
          const singleMsg: admin.messaging.Message = {
            notification: basePayload.notification,
            data: basePayload.data,
            android: basePayload.android,
            apns,
            token: t,
          } as any;
          const sentId = await admin.messaging().send(singleMsg);
          perResults.push({success: true, token: t, messageId: sentId} as any);
        } catch (e) {
          perResults.push({success: false, error: e, token: t});
        }
      }

      response = {
        responses: perResults.map(r => ({success: r.success, error: r.error})),
        successCount: perResults.filter(r => r.success).length,
        failureCount: perResults.filter(r => !r.success).length,
      };
    }

    // Cleanup invalid tokens (do not log details in production)
    const invalidTokens: string[] = [];
    if (response && Array.isArray(response.responses)) {
      response.responses.forEach((resp: any, idx: number) => {
        if (!resp.success) {
          const err = resp.error;
          const code = (
            (err && ((err as any).code || (err as any).message)) ||
            ''
          )
            .toString()
            .toLowerCase();
          const patterns = [
            'registration-token-not-registered',
            'invalid-registration-token',
            'not-registered',
            'messaging/registration-token-not-registered',
            'messaging/invalid-registration-token',
          ];
          if (patterns.some((p: string) => code.includes(p)))
            invalidTokens.push(tokens[idx]);
        }
      });
    }

    if (invalidTokens.length) {
      try {
        if (Array.isArray(rawTokens)) {
          const newTokens = tokens.filter(t => !invalidTokens.includes(t));
          await userRef.update({fcmTokens: newTokens});
        } else {
          const single = rawTokens as string;
          if (invalidTokens.includes(single)) {
            await userRef.update({fcmToken: ''});
          }
        }
      } catch (e) {
        // failed to cleanup invalid tokens (not logged)
      }
    }

    return response;
  } catch (error) {
    return null;
  }
}

// Notify inviter of registration, but do NOT give credits yet
export const notifyInviterOnRegistration = functions.firestore
  .document('users/{userId}')
  .onCreate(async (snap, context) => {
    const newUser = snap.data();
    const invitedBy = (newUser.invitedBy || '').trim().toUpperCase();
    if (!invitedBy) return null;

    // Find the inviter by referralCode
    const inviterQuery = await admin
      .firestore()
      .collection('users')
      .where('referralCode', '==', invitedBy)
      .limit(1)
      .get();

    if (inviterQuery.empty) {
      console.log(`No inviter found with referralCode: ${invitedBy}`);
      return null;
    }

    const inviterDoc = inviterQuery.docs[0];
    const inviterId = inviterDoc.id;

    // Compose full name for notification
    const fullName = [newUser.name, newUser.lastName].filter(Boolean).join(' ');

    // Create notification document (no message, just data for translation)
    await admin
      .firestore()
      .collection('notifications')
      .add({
        userId: inviterId,
        type: 'referral_pending',
        invitedPerson: fullName,
        role: newUser.role || 'client',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });

    // Send push notification if inviter has an FCM token
    // Send push notification via centralized helper (if any token exists)
    try {
      await sendPushWithBadge(inviterId, {
        notification: {title: 'Referral Update', body: ''},
        data: {
          type: 'referral_pending',
          invitedPerson: fullName,
          role: newUser.role,
        },
      });
      console.log(`Attempted push notification to inviter ${inviterId}`);
    } catch (err) {
      console.error('Error sending push via helper:', err);
    }

    console.log(
      `Notified inviter ${inviterId} about registration of user ${context.params.userId}`,
    );
    return null;
  });

// HTTPS endpoint — custom token-based email verification using MailerSend HTTP API
export const sendVerification = functions
  .runWith({secrets: [MAILERSEND_API_KEY]})
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({error: 'Method Not Allowed'});
      return;
    }

    try {
      const authHeader = (req.get('Authorization') || '').trim();
      let idToken: string | undefined;
      if (authHeader.startsWith('Bearer ')) idToken = authHeader.split(' ')[1];
      if (!idToken && req.body?.idToken) idToken = req.body.idToken;
      if (!idToken) {
        res.status(401).json({error: 'Missing idToken'});
        return;
      }

      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded.uid;
      const email = decoded.email || req.body?.email;
      if (!email) {
        res.status(400).json({error: 'Missing email address'});
        return;
      }

      // Generate a secure random token — bypasses Firebase Auth action-code rate limits entirely
      const crypto = require('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

      // Store token in Firestore
      await admin.firestore().collection('emailVerifications').doc(token).set({
        uid,
        email,
        expiresAt,
        used: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const functionBase =
        'https://us-central1-keetchen-c8e65.cloudfunctions.net';
      const verifyLink = `${functionBase}/verifyEmail?token=${token}`;

      // Use MailerSend HTTP API (works on free plan — no SMTP needed)
      const https = require('https');
      const body = JSON.stringify({
        from: {email: 'noreply@keetchen.app', name: 'Keetchen'},
        to: [{email}],
        subject: 'Verify your Keetchen email',
        html: `
        <p>Hello,</p>
        <p>Please verify your Keetchen account by clicking the link below:</p>
        <p><a href="${verifyLink}">Verify email</a></p>
        <p>If the link does not work, copy and paste this URL into your browser:</p>
        <p>${verifyLink}</p>
        <p>This link expires in 24 hours.</p>
        <p>Thanks — Keetchen</p>
      `,
      });

      await new Promise<void>((resolve, reject) => {
        const request = https.request(
          {
            hostname: 'api.mailersend.com',
            path: '/v1/email',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${MAILERSEND_API_KEY.value()}`,
              'Content-Length': Buffer.byteLength(body),
            },
          },
          (response: any) => {
            let data = '';
            response.on('data', (chunk: any) => {
              data += chunk;
            });
            response.on('end', () => {
              if (response.statusCode >= 200 && response.statusCode < 300) {
                resolve();
              } else {
                reject(
                  new Error(
                    `MailerSend API error ${response.statusCode}: ${data}`,
                  ),
                );
              }
            });
          },
        );
        request.on('error', reject);
        request.write(body);
        request.end();
      });

      res.json({success: true});
      return;
    } catch (err) {
      console.error('sendVerification error:', err);
      res.status(500).json({error: 'Internal server error'});
      return;
    }
  });

// HTTPS endpoint — validates the custom token and marks the user's email as verified
export const verifyEmail = functions.https.onRequest(async (req, res) => {
  const token = ((req.query.token as string) || '').trim();

  const page = (
    title: string,
    emoji: string,
    heading: string,
    body: string,
    color: string,
  ) => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      <title>${title}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
               background: #f5f5f5; display: flex; align-items: center;
               justify-content: center; min-height: 100vh; padding: 20px; }
        .card { background: white; border-radius: 16px; padding: 40px 32px;
                max-width: 420px; width: 100%; text-align: center;
                box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
        .emoji { font-size: 64px; margin-bottom: 20px; }
        h1 { color: ${color}; font-size: 24px; margin-bottom: 12px; }
        p { color: #666; font-size: 16px; line-height: 1.5; }
        .hint { margin-top: 24px; font-size: 14px; color: #999; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="emoji">${emoji}</div>
        <h1>${heading}</h1>
        <p>${body}</p>
        <p class="hint">You can close this page and return to the Keetchen app.</p>
      </div>
    </body>
    </html>`;

  if (!token) {
    res
      .status(400)
      .send(
        page(
          'Error',
          '❌',
          'Invalid Link',
          'This verification link is missing a token.',
          '#e53935',
        ),
      );
    return;
  }

  try {
    const docRef = admin
      .firestore()
      .collection('emailVerifications')
      .doc(token);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      res
        .status(400)
        .send(
          page(
            'Error',
            '❌',
            'Invalid Link',
            'This verification link is invalid or has already expired.',
            '#e53935',
          ),
        );
      return;
    }

    const data = docSnap.data()!;

    if (data.used) {
      res.send(
        page(
          'Already Verified',
          '✅',
          'Already Verified',
          "Your email address has already been verified. You're all set!",
          '#43a047',
        ),
      );
      return;
    }

    if (Date.now() > data.expiresAt) {
      res
        .status(400)
        .send(
          page(
            'Link Expired',
            '⏰',
            'Link Expired',
            'This verification link has expired. Please open the Keetchen app and request a new verification email.',
            '#fb8c00',
          ),
        );
      return;
    }

    // Mark email as verified in Firebase Auth
    await admin.auth().updateUser(data.uid, {emailVerified: true});

    // Mark token as used
    await docRef.update({
      used: true,
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.send(
      page(
        'Email Verified',
        '🎉',
        'Email Verified!',
        'Your Keetchen account has been successfully verified. You can now log in and start using the app.',
        '#43a047',
      ),
    );
    return;
  } catch (err) {
    console.error('verifyEmail error:', err);
    res
      .status(500)
      .send(
        page(
          'Error',
          '❌',
          'Something went wrong',
          'Verification failed. Please try again or contact support.',
          '#e53935',
        ),
      );
    return;
  }
});

export const rewardInviterOnFirstOrder = functions.firestore
  .document('orders/{orderId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // Only proceed if status changed to 'delivered'
    if (before.status === after.status || after.status !== 'delivered') {
      return null;
    }

    const clientId = after.clientId;
    if (!clientId) return null;

    // Get client user document
    const clientRef = admin.firestore().collection('users').doc(clientId);
    const clientDoc = await clientRef.get();
    const clientData = clientDoc.data();

    // Check if client was invited and hasn't triggered referral reward
    if (!clientData?.invitedBy || clientData?.referralRewarded) {
      return null;
    }

    // Check if this is the client's first delivered order
    const deliveredOrdersSnap = await admin
      .firestore()
      .collection('orders')
      .where('clientId', '==', clientId)
      .where('status', '==', 'delivered')
      .get();

    if (deliveredOrdersSnap.size > 1) {
      // Not the first delivered order
      return null;
    }

    // Find the inviter by referralCode
    const inviterQuery = await admin
      .firestore()
      .collection('users')
      .where('referralCode', '==', clientData.invitedBy)
      .limit(1)
      .get();

    if (inviterQuery.empty) {
      console.log(
        `No inviter found with referralCode: ${clientData.invitedBy}`,
      );
      return null;
    }

    const inviterDoc = inviterQuery.docs[0];
    const inviterRef = inviterDoc.ref;
    const inviterId = inviterDoc.id;

    // Allocate credits (e.g., 5)
    const creditsToAdd = 5;
    await inviterRef.update({
      credits: admin.firestore.FieldValue.increment(creditsToAdd),
    });

    // Compose full name for notification
    const fullName = [clientData.name, clientData.lastName]
      .filter(Boolean)
      .join(' ');

    // Create notification document (no message, just data for translation)
    await admin.firestore().collection('notifications').add({
      userId: inviterId,
      type: 'referral',
      creditsEarned: creditsToAdd,
      invitedPerson: fullName,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      read: false,
    });

    // Mark client as rewarded
    await clientRef.update({referralRewarded: true});

    // Optionally, send push notification (let app translate)
    try {
      await sendPushWithBadge(inviterId, {
        notification: {title: 'Referral Bonus!', body: ''},
        data: {
          type: 'referral',
          creditsEarned: String(creditsToAdd),
          invitedPerson: fullName,
        },
      });
      console.log(`Attempted push notification to inviter ${inviterId}`);
    } catch (err) {
      console.error('Error sending push via helper:', err);
    }

    console.log(
      `Allocated ${creditsToAdd} credits to inviter ${inviterId} for client ${clientId}'s first delivered order`,
    );
    return null;
  });

export const incrementReviewsCountOnReviewCreate = functions.firestore
  .document('reviews/{reviewId}')
  .onCreate(async (snap, context) => {
    const review = snap.data();
    const batch = admin.firestore().batch();

    // Only increment vendor's reviewsCount if this is a vendor review (no foodItemId)
    if (review.vendorId && !review.foodItemId) {
      const vendorRef = admin
        .firestore()
        .collection('users')
        .doc(review.vendorId);
      batch.update(vendorRef, {
        reviewsCount: admin.firestore.FieldValue.increment(1),
      });
    }

    // Only increment food item's reviewsCount if this is a food review
    if (review.foodItemId) {
      const foodItemRef = admin
        .firestore()
        .collection('foodItems')
        .doc(review.foodItemId);
      batch.update(foodItemRef, {
        reviewsCount: admin.firestore.FieldValue.increment(1),
      });
    }

    await batch.commit();

    // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
    const shouldSend = await shouldSendNotification(
      review.vendorId,
      'newReview',
    );
    if (!shouldSend) {
      console.log(
        `Skipping new_review notification for vendor ${review.vendorId} - disabled in preferences`,
      );
      return null;
    }

    // Fetch the order's or booking's publicCode using orderId or bookingId from the review
    let publicCode = null;
    if (review.orderId) {
      const orderSnap = await admin
        .firestore()
        .collection('orders')
        .doc(review.orderId)
        .get();
      if (orderSnap.exists) {
        publicCode = orderSnap.get('publicCode') || null;
      }
    }
    // If there's no order publicCode, try booking
    if (!publicCode && review.bookingId) {
      const bookingSnap = await admin
        .firestore()
        .collection('bookings')
        .doc(review.bookingId)
        .get();
      if (bookingSnap.exists) {
        publicCode = bookingSnap.get('publicCode') || null;
      }
    }

    // Create a notification for the vendor (translatable in app)
    await admin
      .firestore()
      .collection('notifications')
      .add({
        userId: review.vendorId,
        type: 'new_review',
        reviewId: context.params.reviewId,
        foodItemId: review.foodItemId || null,
        clientName: review.clientName || null,
        hideClientName: review.hideClientName || false,
        publicCode: publicCode,
        orderId: review.orderId || null,
        bookingId: review.bookingId || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });

    return null;
  });

export const notifyVendorOnReviewUpdate = functions.firestore
  .document('reviews/{reviewId}')
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
      'reviewUpdate',
    );
    if (!shouldSend) {
      console.log(
        `Skipping review_update notification for vendor ${after.vendorId} - disabled in preferences`,
      );
      return null;
    }

    // Fetch the order's or booking's publicCode using orderId or bookingId from the review
    let publicCode = null;
    if (after.orderId) {
      const orderSnap = await admin
        .firestore()
        .collection('orders')
        .doc(after.orderId)
        .get();
      if (orderSnap.exists) {
        publicCode = orderSnap.get('publicCode') || null;
      }
    }
    if (!publicCode && after.bookingId) {
      const bookingSnap = await admin
        .firestore()
        .collection('bookings')
        .doc(after.bookingId)
        .get();
      if (bookingSnap.exists) {
        publicCode = bookingSnap.get('publicCode') || null;
      }
    }

    await admin
      .firestore()
      .collection('notifications')
      .add({
        userId: after.vendorId,
        type: 'review_update',
        reviewId: context.params.reviewId,
        foodItemId: after.foodItemId || null,
        clientName: after.clientName || null,
        hideClientName: after.hideClientName || false,
        publicCode: publicCode,
        orderId: after.orderId || null,
        bookingId: after.bookingId || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });

    return null;
  });

export const decrementReviewsCountOnReviewDelete = functions.firestore
  .document('reviews/{reviewId}')
  .onDelete(async (snap, context) => {
    const review = snap.data();
    const batch = admin.firestore().batch();

    // Decrement vendor's reviewsCount and delete vendor rating doc if this is a vendor review (no foodItemId)
    if (review.vendorId && !review.foodItemId) {
      const vendorRef = admin
        .firestore()
        .collection('users')
        .doc(review.vendorId);
      batch.update(vendorRef, {
        reviewsCount: admin.firestore.FieldValue.increment(-1),
      });

      // Also delete the vendor's rating doc for this client
      if (review.clientId) {
        const ratingRef = admin
          .firestore()
          .collection('users')
          .doc(review.vendorId)
          .collection('ratings')
          .doc(review.clientId);
        batch.delete(ratingRef);
      }
    }

    // Decrement food item's reviewsCount and delete food item rating doc if this is a food review
    if (review.foodItemId) {
      const foodItemRef = admin
        .firestore()
        .collection('foodItems')
        .doc(review.foodItemId);
      batch.update(foodItemRef, {
        reviewsCount: admin.firestore.FieldValue.increment(-1),
      });

      // Also delete the food item's rating doc for this client
      if (review.clientId) {
        const foodRatingRef = admin
          .firestore()
          .collection('foodItems')
          .doc(review.foodItemId)
          .collection('ratings')
          .doc(review.clientId);
        batch.delete(foodRatingRef);
      }
    }

    await batch.commit();
    return null;
  });

export const notifyClientOnVendorResponse = functions.firestore
  .document('reviews/{reviewId}')
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
        'vendorResponse',
      );
      if (!shouldSend) {
        console.log(
          `Skipping vendor_response notification for client ${after.clientId} - disabled in preferences`,
        );
        return null;
      }

      // Fetch vendor name
      let vendorName = '';
      if (after.vendorId) {
        const vendorDoc = await admin
          .firestore()
          .collection('users')
          .doc(after.vendorId)
          .get();
        vendorName = vendorDoc.exists ? vendorDoc.get('name') || '' : '';
      }

      // Fetch publicCode from order or booking when available
      let publicCode = null;
      if (after.orderId) {
        const orderSnap = await admin
          .firestore()
          .collection('orders')
          .doc(after.orderId)
          .get();
        if (orderSnap.exists) publicCode = orderSnap.get('publicCode') || null;
      }
      if (!publicCode && after.bookingId) {
        const bookingSnap = await admin
          .firestore()
          .collection('bookings')
          .doc(after.bookingId)
          .get();
        if (bookingSnap.exists)
          publicCode = bookingSnap.get('publicCode') || null;
      }

      await admin
        .firestore()
        .collection('notifications')
        .add({
          userId: after.clientId,
          type: 'vendor_response',
          reviewId: context.params.reviewId,
          vendorId: after.vendorId,
          vendorName: vendorName,
          foodItemId: after.foodItemId || null,
          publicCode: publicCode || after.publicCode || null,
          hideClientName: after.hideClientName || false,
          clientName: after.clientName || null,
          responseText: after.response?.text || '',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          read: false,
        });
    }
    return null;
  });

export const notifyClientToReviewVendor = functions.firestore
  .document('orders/{orderId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // Only proceed if status changed to 'delivered'
    if (before.status === after.status || after.status !== 'delivered') {
      return null;
    }

    // Get clientId and vendorId
    const clientId = after.clientId;
    const vendorId = after.vendorId;
    if (!clientId || !vendorId) return null;

    // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
    const shouldSend = await shouldSendNotification(
      clientId,
      'request_vendor_review',
    );
    if (!shouldSend) {
      console.log(
        `Skipping request_vendor_review notification for client ${clientId} - disabled in preferences`,
      );
      return null;
    }

    // Get order public code
    const publicCode = after.publicCode || '';
    const reviewTimestamp = new Date(Date.now() + 1000); // 1 second later

    // Create a notification for the client to review the vendor
    await admin.firestore().collection('notifications').add({
      userId: clientId,
      type: 'request_vendor_review',
      vendorId: vendorId,
      orderId: context.params.orderId,
      publicCode: publicCode,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: reviewTimestamp,
      read: false,
    });

    return null;
  });

// export const rewardInviterOnVendorSubscription = functions.firestore
//   .document("users/{vendorId}")
//   .onUpdate(async (change, context) => {
//     const before = change.before.data();
//     const after = change.after.data();

//     // Only proceed if role is vendor and menuSlots changed from falsy to truthy (subscription activated)
//     if (
//       after.role !== "vendor" ||
//       !after.invitedBy ||
//       before.menuSlots === after.menuSlots || // No change
//       !after.menuSlots || // Not activated
//       after.referralRewarded // Already rewarded
//     ) {
//       return null;
//     }

//     // Find inviter by referralCode
//     const inviterQuery = await admin
//       .firestore()
//       .collection("users")
//       .where("referralCode", "==", after.invitedBy)
//       .limit(1)
//       .get();

//     if (inviterQuery.empty) {
//       console.log(`No inviter found with referralCode: ${after.invitedBy}`);
//       return null;
//     }

//     const inviterDoc = inviterQuery.docs[0];
//     const inviterRef = inviterDoc.ref;
//     const inviterId = inviterDoc.id;
//     const inviterFcmToken = inviterDoc.get("fcmToken");

//     // Add 15 credits to inviter
//     const creditsToAdd = 15;
//     await inviterRef.update({
//       credits: admin.firestore.FieldValue.increment(creditsToAdd),
//     });

//     // Mark vendor as rewarded so it doesn't trigger again
//     await change.after.ref.update({ referralRewarded: true });

//     // Compose full name for notification
//     const fullName = [after.name, after.lastName].filter(Boolean).join(" ");

//     // Create notification document
//     await admin.firestore().collection("notifications").add({
//       userId: inviterId,
//       type: "referral",
//       creditsEarned: creditsToAdd,
//       invitedPerson: fullName,
//       createdAt: admin.firestore.FieldValue.serverTimestamp(),
//       timestamp: admin.firestore.FieldValue.serverTimestamp(),
//       read: false,
//     });

//     // Optionally, send push notification
//     if (inviterFcmToken) {
//       const payload = {
//         notification: {
//           title: "Referral Bonus!",
//           body: "", // Let app translate
//         },
//         token: inviterFcmToken,
//         data: {
//           type: "referral",
//           creditsEarned: String(creditsToAdd),
//           invitedPerson: fullName,
//         },
//       };

//       try {
//         await admin.messaging().send(payload);
//         console.log(`Push notification sent to inviter ${inviterId}`);
//       } catch (err) {
//         console.error("Error sending push notification:", err);
//       }
//     }

//     console.log(
//       `Allocated ${creditsToAdd} credits to inviter ${inviterId} for vendor ${context.params.vendorId}'s subscription`
//     );
//     return null;
//   });

export const rewardInviterOnVendorFirstFoodItem = functions.firestore
  .document('foodItems/{foodItemId}')
  .onCreate(async (snap, context) => {
    const foodItem = snap.data();
    if (!foodItem) return null;

    const vendorId = foodItem.vendorId;
    if (!vendorId) {
      console.log('Food item has no vendorId, skipping referral reward.');
      return null;
    }

    const vendorRef = admin.firestore().collection('users').doc(vendorId);
    const vendorDoc = await vendorRef.get();
    if (!vendorDoc.exists) {
      console.log(`Vendor ${vendorId} not found`);
      return null;
    }
    const vendorData = vendorDoc.data();

    // Only proceed if vendor was invited and not already rewarded
    const invitedBy = vendorData?.invitedBy;
    if (!invitedBy) {
      console.log(
        `Vendor ${vendorId} was not invited, skipping referral reward.`,
      );
      return null;
    }
    if (vendorData?.referralRewarded) {
      console.log(
        `Vendor ${vendorId} already triggered referral reward, skipping.`,
      );
      return null;
    }

    // Find inviter by referralCode
    const inviterQuery = await admin
      .firestore()
      .collection('users')
      .where('referralCode', '==', invitedBy)
      .limit(1)
      .get();

    if (inviterQuery.empty) {
      console.log(`No inviter found with referralCode: ${invitedBy}`);
      return null;
    }

    const inviterDoc = inviterQuery.docs[0];
    const inviterRef = inviterDoc.ref;
    const inviterId = inviterDoc.id;

    const creditsToAdd = 10;

    // Use transaction to avoid race conditions (e.g., multiple food items created concurrently)
    try {
      await admin.firestore().runTransaction(async tx => {
        const freshVendorSnap = await tx.get(vendorRef);
        if (!freshVendorSnap.exists) throw new Error('Vendor doc disappeared');
        const freshVendor = freshVendorSnap.data();
        if (freshVendor?.referralRewarded) {
          throw new Error('Already rewarded in concurrent transaction');
        }

        tx.update(inviterRef, {
          credits: admin.firestore.FieldValue.increment(creditsToAdd),
        });

        tx.update(vendorRef, {
          referralRewarded: true,
        });
      });
    } catch (err) {
      // If transaction failed because already rewarded, quietly exit
      if (String(err).includes('Already rewarded')) {
        console.log('Referral already rewarded by concurrent transaction.');
        return null;
      }
      console.error('Transaction error rewarding inviter:', err);
      return null;
    }

    // Compose full name for notification
    const fullName = [vendorData?.name, vendorData?.lastName]
      .filter(Boolean)
      .join(' ');

    // Create notification document
    await admin.firestore().collection('notifications').add({
      userId: inviterId,
      type: 'referral',
      creditsEarned: creditsToAdd,
      invitedPerson: fullName,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      read: false,
    });

    // Optionally send push notification to inviter
    try {
      await sendPushWithBadge(inviterId, {
        notification: {title: 'Referral Bonus!', body: ''},
        data: {
          type: 'referral',
          creditsEarned: String(creditsToAdd),
          invitedPerson: fullName,
        },
      });
      console.log(`Attempted push notification to inviter ${inviterId}`);
    } catch (err) {
      console.error('Error sending push via helper:', err);
    }

    console.log(
      `Allocated ${creditsToAdd} credits to inviter ${inviterId} for vendor ${vendorId}'s first food item`,
    );
    return null;
  });

// Aggregate vendor ratings when a rating is added/updated/deleted
export const aggregateVendorRatings = functions.firestore
  .document('users/{vendorId}/ratings/{ratingId}')
  .onWrite(async (change, context) => {
    console.log('Vendor rating aggregation triggered!');

    const vendorId = context.params.vendorId;
    const ratingsRef = admin
      .firestore()
      .collection('users')
      .doc(vendorId)
      .collection('ratings');
    const vendorRef = admin.firestore().collection('users').doc(vendorId);

    const ratingsSnapshot = await ratingsRef.get();
    let total = 0;
    let count = 0;

    ratingsSnapshot.forEach(doc => {
      const data = doc.data();
      if (typeof data.stars === 'number') {
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
        `Updated vendor ${vendorId}: rating=${average}, totalRatings=${count}`,
      );
    } catch (error) {
      console.error('Error updating vendor rating:', error);
    }

    return null;
  });

// Ensure review ratings are mirrored into ratings subcollections so aggregation works
export const syncReviewToRatings = functions.firestore
  .document('reviews/{reviewId}')
  .onCreate(async (snap, context) => {
    const review = snap.data();
    if (!review) return null;

    const clientId = review.clientId;
    const rating = review.rating;
    if (!clientId || typeof rating !== 'number') return null;

    const reviewId = context.params.reviewId;
    const batch = admin.firestore().batch();
    // Upsert vendor-level rating (include booking reviews)
    // Use reviewId as doc ID so each review creates its own rating entry
    try {
      if (review.vendorId && !review.foodItemId) {
        const vendorRatingRef = admin
          .firestore()
          .collection('users')
          .doc(review.vendorId)
          .collection('ratings')
          .doc(reviewId);
        batch.set(vendorRatingRef, {
          stars: rating,
          clientId,
          reviewId,
          vendorId: review.vendorId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Upsert food-item rating when applicable
      if (review.foodItemId) {
        const foodRatingRef = admin
          .firestore()
          .collection('foodItems')
          .doc(review.foodItemId)
          .collection('ratings')
          .doc(reviewId);
        batch.set(foodRatingRef, {
          stars: rating,
          clientId,
          reviewId,
          foodItemId: review.foodItemId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      await batch.commit();
    } catch (e) {
      console.error('Failed to sync review to ratings:', e);
    }

    return null;
  });

// Keep ratings in sync when reviews are updated (e.g., client changes stars)
export const syncReviewUpdateToRatings = functions.firestore
  .document('reviews/{reviewId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    if (!after) return null;

    const clientId = after.clientId;
    const rating = after.rating;
    if (!clientId || typeof rating !== 'number') return null;

    const reviewId = context.params.reviewId;
    const batch = admin.firestore().batch();

    try {
      // If review is a vendor review, update the existing rating doc (keyed by reviewId)
      if (after.vendorId && !after.foodItemId) {
        const vendorRatingRef = admin
          .firestore()
          .collection('users')
          .doc(after.vendorId)
          .collection('ratings')
          .doc(reviewId);
        batch.set(
          vendorRatingRef,
          {
            stars: rating,
            clientId,
            reviewId,
            vendorId: after.vendorId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          {merge: true},
        );
      } else if (before.vendorId && !before.foodItemId && !after.vendorId) {
        // If review changed from vendor-level to non-vendor, delete old vendor rating
        const oldVendorRef = admin
          .firestore()
          .collection('users')
          .doc(before.vendorId)
          .collection('ratings')
          .doc(reviewId);
        batch.delete(oldVendorRef);
      }

      // If review is a food-item review, update the existing rating doc (keyed by reviewId)
      if (after.foodItemId) {
        const foodRatingRef = admin
          .firestore()
          .collection('foodItems')
          .doc(after.foodItemId)
          .collection('ratings')
          .doc(reviewId);
        batch.set(
          foodRatingRef,
          {
            stars: rating,
            clientId,
            reviewId,
            foodItemId: after.foodItemId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          {merge: true},
        );
      } else if (before.foodItemId && !after.foodItemId) {
        // If changed away from food-item review, delete old food rating
        const oldFoodRef = admin
          .firestore()
          .collection('foodItems')
          .doc(before.foodItemId)
          .collection('ratings')
          .doc(reviewId);
        batch.delete(oldFoodRef);
      }

      await batch.commit();
    } catch (e) {
      console.error('Failed to sync updated review to ratings:', e);
    }

    return null;
  });

// Remove ratings when a review is deleted
export const syncReviewDeleteToRatings = functions.firestore
  .document('reviews/{reviewId}')
  .onDelete(async (snap, context) => {
    const review = snap.data();
    if (!review) return null;
    const clientId = review.clientId;
    if (!clientId) return null;

    const reviewId = context.params.reviewId;
    const batch = admin.firestore().batch();

    try {
      if (review.vendorId && !review.foodItemId) {
        const vendorRatingRef = admin
          .firestore()
          .collection('users')
          .doc(review.vendorId)
          .collection('ratings')
          .doc(reviewId);
        batch.delete(vendorRatingRef);
      }

      if (review.foodItemId) {
        const foodRatingRef = admin
          .firestore()
          .collection('foodItems')
          .doc(review.foodItemId)
          .collection('ratings')
          .doc(reviewId);
        batch.delete(foodRatingRef);
      }

      await batch.commit();
    } catch (e) {
      console.error('Failed to remove rating on review delete:', e);
    }

    return null;
  });

export const notifyAdminOnSubscriptionReceipt = functions.firestore
  .document('subscriptionPayments/{receiptId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    if (!data || data.status !== 'pending') return null;

    // Get your email credentials from Firebase config
    const adminEmail = 'samansaeedi102@gmail.com'; // Change to your admin email
    const yahooEmail = (await GMAIL_EMAIL.value()) || '';
    const yahooPassword = await GMAIL_PASSWORD.value();

    if (!yahooEmail || !yahooPassword) {
      console.error('❌ Yahoo credentials not configured');
      throw new Error('Yahoo credentials not configured');
    }

    // Create transporter using Yahoo
    const transporter = nodemailer.createTransport({
      service: 'yahoo',
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
      console.log('✅ Admin notified about new subscription payment receipt');
    } catch (error) {
      console.error('❌ Failed to send admin email:', error);
    }

    return null;
  });

// Aggregate food item ratings when a rating is added/updated/deleted
export const aggregateFoodItemRatings = functions.firestore
  .document('foodItems/{foodItemId}/ratings/{ratingId}')
  .onWrite(async (change, context) => {
    console.log('Food item rating aggregation triggered!');

    const foodItemId = context.params.foodItemId;
    const foodItemRef = admin
      .firestore()
      .collection('foodItems')
      .doc(foodItemId);
    const ratingsSnap = await foodItemRef.collection('ratings').get();

    let totalStars = 0;
    let totalRatings = ratingsSnap.size;

    ratingsSnap.forEach(doc => {
      const data = doc.data();
      if (typeof data.stars === 'number') {
        totalStars += data.stars;
      }
    });

    const avgRating = totalRatings > 0 ? totalStars / totalRatings : 0;

    await foodItemRef.update({
      rating: Math.round(avgRating * 10) / 10, // round to 1 decimal
      totalRatings: totalRatings,
    });

    console.log(
      `Updated food item ${foodItemId}: rating=${avgRating}, totalRatings=${totalRatings}`,
    );
  });

// Notify vendor when a new order is created
export const notifyVendorOnNewOrder = functions.firestore
  .document('orders/{orderId}')
  .onCreate(async (snap, context) => {
    const order = snap.data();
    if (!order) return null;

    const vendorId = order.vendorId;
    const clientName = order.clientName || '';
    const publicCode = order.publicCode || ''; // ✅ This gets the publicCode from the order
    const orderId = context.params.orderId;

    if (!vendorId) {
      console.log('No vendor ID found for order');
      return null;
    }

    // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
    const shouldSend = await shouldSendNotification(vendorId, 'newOrder');
    if (!shouldSend) {
      console.log(
        `Skipping new order notification for vendor ${vendorId} - disabled in preferences`,
      );
      return null;
    }

    try {
      // Create notification for vendor
      await admin.firestore().collection('notifications').add({
        userId: vendorId,
        type: 'newOrder',
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
        }`,
      );
    } catch (error) {
      console.error('Error creating new order notification:', error);
    }

    return null;
  });

// Notify client when order status changes
export const notifyClientOnOrderStatusChange = functions.firestore
  .document('orders/{orderId}')
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
      ? `${after.clientInfo.name} ${after.clientInfo.lastName || ''}`.trim()
      : after.clientName || '';

    if (!clientId) {
      console.log('No client ID found for order');
      return null;
    }

    // Determine notification type based on new status
    let notificationType = '';

    switch (after.status) {
      case 'accepted':
        notificationType = 'orderAccepted';
        break;
      case 'rejected':
        notificationType = 'orderRejected';
        break;
      case 'delivered':
        notificationType = 'orderDelivered';
        break;
      case 'expired':
        // New: map an expired order to an orderExpired notification
        notificationType = 'orderExpired';
        break;
      default:
        console.log(`No notification needed for status: ${after.status}`);
        return null;
    }

    // ✅ CHECK USER PREFERENCES BEFORE CREATING NOTIFICATION
    const shouldSend = await shouldSendNotification(clientId, notificationType);
    if (!shouldSend) {
      console.log(
        `Skipping ${notificationType} notification for client ${clientId} - disabled in preferences`,
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
      if (notificationType === 'orderAccepted') {
        const deliveryDate = after.deliveryDate || after.selectedDate;
        notificationData = {
          ...notificationData,
          deliveryDate: deliveryDate || null,
          delivered: false,
        };
      } else if (notificationType === 'orderDelivered') {
        notificationData = {
          ...notificationData,
          delivered: true,
        };
      } else if (notificationType === 'orderExpired') {
        // Include expiry-specific metadata so the app can display a translated message
        notificationData = {
          ...notificationData,
          expired: true,
          expiredAt:
            after.expiredAt || admin.firestore.FieldValue.serverTimestamp(),
          expiryReason: after.expiryReason || null,
        };
      }

      // If order was accepted and it's a pickup, mark related holds as accepted
      if (after.status === 'accepted' && after.deliveryMethod === 'pickup') {
        try {
          const holdsQuery = await admin
            .firestore()
            .collection('pickupSlotHolds')
            .where('orderId', '==', orderId)
            .where('status', '==', 'active')
            .get();

          const batch = admin.firestore().batch();
          holdsQuery.docs.forEach(h => {
            batch.update(h.ref, {
              status: 'accepted',
              acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          });

          await batch.commit();
          console.log(
            `Accepted ${holdsQuery.size} pickup holds for order ${orderId}`,
          );
        } catch (err) {
          console.error(
            'Failed to confirm pickup holds for accepted order:',
            err,
          );
        }
      }

      // Create notification for client
      await admin.firestore().collection('notifications').add(notificationData);

      console.log(
        `${notificationType} notification created for client ${clientId}, order ${publicCode}`,
      );
    } catch (error) {
      console.error(`Error creating ${notificationType} notification:`, error);
    }

    return null;
  });

function getNotificationTitleAndBody(
  type: string,
  data: Record<string, any>,
): {title: string; body: string} {
  const publicCode = data.publicCode || '';
  const clientName = data.clientName || 'A client';
  const vendorName = data.vendorName || 'The vendor';
  const rejectionReason = data.rejectionReason || '';
  const cancellationReason = data.cancellationReason || '';
  const serviceType = data.serviceType || 'booking';
  const mealTime = data.mealTime || '';
  const deliveryDate = data.deliveryDate
    ? new Date(data.deliveryDate).toDateString()
    : '';
  const invitedPerson = data.invitedPerson || 'someone';
  const creditsEarned =
    data.creditsEarned != null ? String(data.creditsEarned) : '';
  const responseText = data.responseText || '';

  switch (type) {
    case 'newOrder':
      return {
        title: '🛒 New Order',
        body: publicCode
          ? `New order #${publicCode} from ${clientName}`
          : `New order from ${clientName}`,
      };
    case 'orderAccepted':
      return {
        title: '✅ Order Accepted',
        body: publicCode
          ? `Your order #${publicCode} has been accepted${
              deliveryDate ? ` – delivery on ${deliveryDate}` : ''
            }.`
          : `Your order has been accepted${
              deliveryDate ? ` – delivery on ${deliveryDate}` : ''
            }.`,
      };
    case 'orderRejected':
      return {
        title: '❌ Order Rejected',
        body: publicCode
          ? `Your order #${publicCode} was rejected${
              rejectionReason ? `: ${rejectionReason}` : ''
            }.`
          : `Your order was rejected${
              rejectionReason ? `: ${rejectionReason}` : ''
            }.`,
      };
    case 'orderDelivered':
      return {
        title: '📦 Order Delivered',
        body: publicCode
          ? `Your order #${publicCode} has been delivered!`
          : 'Your order has been delivered!',
      };
    case 'newBooking':
      return {
        title: '📅 New Booking',
        body: publicCode
          ? `New ${serviceType} booking #${publicCode} from ${clientName}`
          : `New ${serviceType} booking from ${clientName}`,
      };
    case 'bookingAccepted':
      return {
        title: '✅ Booking Accepted',
        body: publicCode
          ? `Your booking #${publicCode} has been accepted${
              deliveryDate
                ? ` – ${mealTime ? mealTime + ' on ' : ''}${deliveryDate}`
                : ''
            }.`
          : `Your booking has been accepted.`,
      };
    case 'bookingRejected':
      return {
        title: '❌ Booking Rejected',
        body: publicCode
          ? `Your booking #${publicCode} was rejected${
              rejectionReason ? `: ${rejectionReason}` : ''
            }.`
          : `Your booking was rejected${
              rejectionReason ? `: ${rejectionReason}` : ''
            }.`,
      };
    case 'bookingCancelled':
      return {
        title: '🚫 Booking Cancelled',
        body: publicCode
          ? `Your booking #${publicCode} was cancelled${
              cancellationReason ? `: ${cancellationReason}` : ''
            }.`
          : `Your booking was cancelled.`,
      };
    case 'bookingExpired':
      return {
        title: '⏰ Booking Expired',
        body: publicCode
          ? `Your booking #${publicCode} has expired.`
          : 'Your booking has expired.',
      };
    case 'orderExpired':
      return {
        title: '⏰ Order Expired',
        body: publicCode
          ? `Your order #${publicCode} hold has expired.`
          : 'Your order hold has expired.',
      };
    case 'pickupHoldExpired':
    case 'pickup_hold_expired':
    case 'holdExpired':
      return {
        title: '⏰ Hold Expired',
        body: 'Your pickup hold has expired.',
      };
    case 'bookingHoldExpired':
    case 'booking_hold_expired':
      return {
        title: '⏰ Booking Hold Expired',
        body: 'Your booking hold has expired.',
      };
    case 'referral':
      return {
        title: '🎁 Referral Reward',
        body: creditsEarned
          ? `You earned ${creditsEarned} credits for inviting ${invitedPerson}!`
          : `You earned credits for inviting ${invitedPerson}!`,
      };
    case 'referral_pending':
      return {
        title: '👥 Referral Pending',
        body: `${invitedPerson} signed up with your code – keep an eye out for your reward!`,
      };
    case 'new_review':
      return {
        title: '⭐ New Review',
        body: `You received a new review${
          publicCode ? ` for order #${publicCode}` : ''
        }.`,
      };
    case 'review_update':
      return {
        title: '✏️ Review Updated',
        body: `A review was updated${
          publicCode ? ` for order #${publicCode}` : ''
        }.`,
      };
    case 'review_deleted':
      return {
        title: '🗑 Review Removed',
        body: `A review was removed${
          publicCode ? ` for order #${publicCode}` : ''
        }.`,
      };
    case 'vendor_response':
      return {
        title: '💬 Vendor Response',
        body: responseText
          ? `${vendorName} replied: ${responseText.substring(0, 80)}`
          : `${vendorName} responded to your review.`,
      };
    case 'request_vendor_review':
      return {
        title: '⭐ Leave a Review',
        body: publicCode
          ? `How was your order #${publicCode}? Tap to leave a review.`
          : 'How was your experience? Tap to leave a review.',
      };
    default:
      return {
        title: 'Keetchen',
        body: data.message || 'You have a new notification.',
      };
  }
}

export const sendPushOnNotificationCreate = functions.firestore
  .document('notifications/{notificationId}')
  .onCreate(async (snap: functions.firestore.DocumentSnapshot) => {
    console.log('Notification push function triggered!');

    const notification = snap.data();
    if (!notification) {
      console.log('No notification data found.');
      return null;
    }

    const userId = notification.userId;
    if (!userId) {
      console.log('Notification missing userId, skipping push.');
      return null;
    }

    const notificationType = notification.type || 'general';

    // Respect user preferences
    const shouldSend = await shouldSendNotification(userId, notificationType);
    if (!shouldSend) {
      console.log(
        `Skipping notification for user ${userId}, type ${notificationType} - disabled in preferences`,
      );
      return null;
    }

    // Fetch role (helper may use tokens + badge logic)
    const userDoc = await admin
      .firestore()
      .collection('users')
      .doc(userId)
      .get();
    const userRole = userDoc.exists
      ? userDoc.get('role') || 'client'
      : 'client';

    // Build title/body so the OS can display the notification even when the app is killed/backgrounded.
    const {title, body} = getNotificationTitleAndBody(
      notificationType,
      notification,
    );

    // Data payload – client uses this for deep-linking and localisation when the app opens.
    const dataPayload: Record<string, string> = {
      type: String(notificationType),
      userId: String(userId),
      userRole: String(userRole),
      message: String(notification.message || ''),
      orderId: String(notification.orderId || ''),
      publicCode: String(notification.publicCode || ''),
      // stringify full notification so client has every field available for interpolation
      payload: JSON.stringify(notification),
    };

    // Add a few commonly-used fields if present
    if (notification.invitedPerson)
      dataPayload.invitedPerson = String(notification.invitedPerson);
    if (notification.creditsEarned)
      dataPayload.creditsEarned = String(notification.creditsEarned);
    if (notification.vendorName)
      dataPayload.vendorName = String(notification.vendorName);
    if (notification.clientName)
      dataPayload.clientName = String(notification.clientName);

    // Use a visible notification payload (title + body + sound) so the OS shows the banner
    // even when the app is in the background or completely killed.
    // The `data` block is still included for client-side deep-linking when the user taps.
    const basePayload: Partial<admin.messaging.Message> = {
      notification: {title, body},
      data: dataPayload,
      android: {
        notification: {
          title,
          body,
          sound: 'default',
          icon: 'ic_notification',
          color: '#FF6B35',
        },
        priority: 'high' as const,
      },
      apns: {
        payload: {
          aps: {
            alert: {title, body},
            sound: 'default',
            badge: 1, // sendPushWithBadge will override this with the real unread count
          },
        },
      },
    };

    try {
      await sendPushWithBadge(userId, basePayload);
      console.log('Dispatched push via helper for user:', userId);
    } catch (error) {
      console.error('Error dispatching push via helper:', error);
    }

    return null;
  });

export const sendChatPushNotification = functions.https.onCall(
  async (data, context) => {
    console.log('Chat push notification function triggered!');

    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'User must be authenticated',
      );
    }

    const {recipientId, senderName, message, conversationId} = data || {};

    if (!recipientId || !senderName || !message) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'recipientId, senderName, and message are required',
      );
    }

    // Respect user preferences for chat messages
    const shouldSend = await shouldSendNotification(recipientId, 'chatMessage');
    if (!shouldSend) {
      console.log(
        `Skipping chat notification for user ${recipientId} - disabled in preferences`,
      );
      return {success: false, reason: 'Chat notifications disabled by user'};
    }

    try {
      // Fetch recipient doc
      const userDoc = await admin
        .firestore()
        .collection('users')
        .doc(recipientId)
        .get();

      const fcmToken = userDoc.exists ? userDoc.get('fcmToken') : null;
      const userRole = userDoc.exists
        ? userDoc.get('role') || 'client'
        : 'client';

      console.log('FCM token retrieved:', fcmToken);

      if (!fcmToken) {
        console.log('No FCM token found for user:', recipientId);
        return {success: false, reason: 'No FCM token found'};
      }

      // Build notification payload
      const notificationTitle = 'New Message';
      const notificationBody = `${senderName}: ${
        typeof message === 'string' && message.length > 50
          ? message.substring(0, 50) + '...'
          : message
      }`;

      // Send via centralized helper (basePayload built below)
      const basePayload: Partial<admin.messaging.Message> = {
        notification: {title: notificationTitle, body: notificationBody},
        data: {
          title: notificationTitle,
          body: notificationBody,
          type: 'chat_message',
          senderId: context.auth.uid,
          senderName,
          conversationId: conversationId || '',
          originalMessage: String(message),
          userRole,
          // for chat messages we don't create a notification doc here; the conversationId
          // will be used as the android notification tag so the client can cancel by conversation
          notificationId: conversationId || '',
        },
        android: {
          notification: {
            title: notificationTitle,
            body: notificationBody,
            icon: 'ic_notification',
            color: '#FF6B35',
            tag: conversationId || undefined,
            sound: 'default',
          },
          priority: 'high' as const,
        },
        apns: {
          payload: {
            aps: {
              alert: {title: notificationTitle, body: notificationBody},
              sound: 'default',
            },
          },
        },
      };

      try {
        const res: any = await sendPushWithBadge(recipientId, basePayload);
        if (res && res.successCount && res.successCount > 0) {
          return {success: true, messageId: 'multicast'};
        }
        return {success: false, reason: 'No devices accepted the message'};
      } catch (error: any) {
        console.error('Error sending chat push via helper:', error);
        return {success: false, error};
      }
    } catch (error: any) {
      console.error('Unexpected error in chat push flow:', error);
      return {success: false, error};
    }
  },
);

// Update APNs badge when a notification's `read` flag changes
export const updateBadgeOnNotificationUpdate = functions.firestore
  .document('notifications/{notificationId}')
  .onUpdate(async (change, context) => {
    try {
      const before = change.before.data();
      const after = change.after.data();
      if (!before || !after) return null;

      // Only act when `read` changed
      if (before.read === after.read) return null;

      const userId = after.userId || before.userId;
      if (!userId) return null;

      // Send a badge-only update (helper computes badge)
      try {
        await sendPushWithBadge(userId, {data: {type: 'badge_update'}});
      } catch (err) {
        // error sending badge update (not logged in production)
      }
    } catch (error) {
      // unexpected error in updateBadgeOnNotificationUpdate (not logged)
    }
    return null;
  });

// Update order statistics when an order status changes
// Cloud Function: updateOrderStatistics
export const updateOrderStatistics = functions.firestore
  .document('orders/{orderId}')
  .onWrite(async (change, context) => {
    console.log('Order statistics update triggered!');

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
      console.log('No vendor ID found for order');
      return null;
    }

    try {
      const vendorRef = admin.firestore().collection('users').doc(vendorId);
      const vendorDoc = await vendorRef.get();
      const vendorData = vendorDoc.data();

      if (!vendorData) {
        console.log('Vendor not found');
        return null;
      }

      // Initialize statistics if they don't exist
      const stats = vendorData.orderStatistics || {
        totalOrders: 0,
        completedOrders: 0,
        pendingOrders: 0,
        rejectedOrders: 0,
        expiredOrders: 0,
        acceptedOrders: 0,
      };

      // Handle order deletion
      if (!afterData) {
        if (beforeStatus === 'pending') {
          stats.pendingOrders = Math.max(0, (stats.pendingOrders || 0) - 1);
        }
        if (beforeStatus === 'delivered') {
          stats.completedOrders = Math.max(0, (stats.completedOrders || 0) - 1);
        }
        if (beforeStatus === 'rejected') {
          stats.rejectedOrders = Math.max(0, (stats.rejectedOrders || 0) - 1);
        }
        if (beforeStatus === 'expired') {
          stats.expiredOrders = Math.max(0, (stats.expiredOrders || 0) - 1);
        }
        if (beforeStatus === 'accepted') {
          stats.acceptedOrders = Math.max(0, (stats.acceptedOrders || 0) - 1);
        }
        stats.totalOrders = Math.max(0, (stats.totalOrders || 0) - 1);

        await vendorRef.update({
          orderStatistics: stats,
          lastOrderUpdate: admin.firestore.FieldValue.serverTimestamp(),
        });
        return null;
      }

      // Status transitions
      if (afterStatus === 'delivered' && beforeStatus !== 'delivered') {
        stats.completedOrders = (stats.completedOrders || 0) + 1;
      }
      if (afterStatus === 'rejected' && beforeStatus !== 'rejected') {
        stats.rejectedOrders = (stats.rejectedOrders || 0) + 1;
      }
      if (afterStatus === 'expired' && beforeStatus !== 'expired') {
        stats.expiredOrders = (stats.expiredOrders || 0) + 1;
      }
      if (afterStatus === 'accepted' && beforeStatus !== 'accepted') {
        // Count accepted orders as ongoing
        stats.acceptedOrders = (stats.acceptedOrders || 0) + 1;
      }
      // Only increment pendingOrders on status change to "pending" if not a new order
      if (
        beforeStatus !== afterStatus &&
        afterStatus === 'pending' &&
        beforeData
      ) {
        stats.pendingOrders = (stats.pendingOrders || 0) + 1;
      }
      if (afterStatus === 'accepted' && beforeStatus !== 'accepted') {
        // Transitional state, do nothing
      }
      if (beforeStatus === 'delivered' && afterStatus !== 'delivered') {
        stats.completedOrders = Math.max(0, (stats.completedOrders || 0) - 1);
      }
      if (beforeStatus === 'rejected' && afterStatus !== 'rejected') {
        stats.rejectedOrders = Math.max(0, (stats.rejectedOrders || 0) - 1);
      }
      if (beforeStatus === 'expired' && afterStatus !== 'expired') {
        stats.expiredOrders = Math.max(0, (stats.expiredOrders || 0) - 1);
      }
      if (beforeStatus === 'accepted' && afterStatus !== 'accepted') {
        stats.acceptedOrders = Math.max(0, (stats.acceptedOrders || 0) - 1);
      }
      if (beforeStatus === 'pending' && afterStatus !== 'pending') {
        stats.pendingOrders = Math.max(0, (stats.pendingOrders || 0) - 1);
      }
      if (!beforeData) {
        stats.totalOrders = (stats.totalOrders || 0) + 1;
        if (afterStatus === 'pending') {
          stats.pendingOrders = (stats.pendingOrders || 0) + 1;
        }
        if (afterStatus === 'delivered') {
          stats.completedOrders = (stats.completedOrders || 0) + 1;
        }
        if (afterStatus === 'expired') {
          stats.expiredOrders = (stats.expiredOrders || 0) + 1;
        }
        if (afterStatus === 'accepted') {
          stats.acceptedOrders = (stats.acceptedOrders || 0) + 1;
        }
      }

      await vendorRef.update({
        orderStatistics: stats,
        lastOrderUpdate: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Updated vendor ${vendorId} statistics:`, stats);
    } catch (error) {
      console.error('Error updating order statistics:', error);
    }

    return null;
  });

export const notifyVendorsOfUpcomingOrders = functions.pubsub
  .schedule('every day 07:00') // Run every day at 7 AM UTC
  .timeZone('UTC')
  .onRun(async _context => {
    const db = admin.firestore();
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const twoDaysLater = new Date(now);
    twoDaysLater.setDate(now.getDate() + 2);

    // Query orders with deliveryDate in [now, twoDaysLater], status pending or accepted
    const ordersSnap = await db
      .collection('orders')
      .where('deliveryDate', '>=', now.toISOString())
      .where('deliveryDate', '<=', twoDaysLater.toISOString())
      .where('status', 'in', ['pending', 'accepted'])
      .get();

    if (ordersSnap.empty) {
      console.log('No upcoming orders found.');
      return null;
    }

    const notifications: any[] = [];

    for (const doc of ordersSnap.docs) {
      const order = doc.data();
      const vendorId = order.vendorId;
      if (!vendorId) continue;

      // Check if a notification for this order & vendor already exists (avoid duplicates)
      const existing = await db
        .collection('notifications')
        .where('userId', '==', vendorId)
        .where('type', '==', 'upcomingOrder')
        .where('orderId', '==', doc.id)
        .get();
      if (!existing.empty) continue;

      notifications.push({
        userId: vendorId,
        type: 'upcomingOrder',
        orderId: doc.id,
        publicCode: order.publicCode || '',
        deliveryDate: order.deliveryDate,
        clientName: order.clientName || '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });
    }

    // Batch create notifications
    const batch = db.batch();
    notifications.forEach(notif => {
      const ref = db.collection('notifications').doc();
      batch.set(ref, notif);
    });
    if (notifications.length > 0) {
      await batch.commit();
      console.log(
        `Created ${notifications.length} upcoming order notifications.`,
      );
    }

    return null;
  });

// Clean up old notifications (runs daily)
export const cleanupOldNotifications = functions.pubsub
  .schedule('0 2 * * *') // Run at 2 AM daily
  .timeZone('UTC')
  .onRun(async (_context: functions.EventContext) => {
    console.log('Cleaning up old notifications...');

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    try {
      const oldNotificationsQuery = admin
        .firestore()
        .collection('notifications')
        .where('timestamp', '<', thirtyDaysAgo)
        .limit(500); // Process in batches

      const snapshot = await oldNotificationsQuery.get();

      if (snapshot.empty) {
        console.log('No old notifications to clean up');
        return;
      }

      const batch = admin.firestore().batch();
      let count = 0;

      snapshot.forEach(doc => {
        batch.delete(doc.ref);
        count++;
      });

      await batch.commit();
      console.log(`Deleted ${count} old notifications`);
    } catch (error) {
      console.error('Error cleaning up old notifications:', error);
    }
  });

// Send email notification to admin when restaurant submits documents
export const notifyAdminRestaurantSubmission = functions
  .runWith({secrets: [MAILERSEND_API_KEY]})
  .firestore.document('users/{userId}')
  .onUpdate(async (change, context) => {
    console.log('Restaurant submission notification triggered!');

    const before = change.before.data();
    const after = change.after.data();
    const userId = context.params.userId;

    // Check if this is a restaurant that just submitted documents
    if (
      after.role === 'vendor' &&
      after.type === 'restaurant' &&
      before.certification?.status !== 'under_review' &&
      after.certification?.status === 'under_review' &&
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
        // Generate a secure one-time token so the admin can approve/reject directly from the email
        const crypto = require('crypto');
        const actionToken = crypto.randomBytes(32).toString('hex');
        await admin.firestore().collection('adminActionTokens').doc(actionToken).set({
          restaurantId: userId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
          used: false,
        });

        // Send email notification with one-click approve/reject buttons
        await sendAdminEmailWithYahoo(restaurantData, actionToken);

        // Also log to admin notifications collection for dashboard
        await admin
          .firestore()
          .collection('adminNotifications')
          .add({
            type: 'restaurant_submission',
            restaurantId: userId,
            restaurantName: restaurantData.name,
            restaurantEmail: restaurantData.email,
            submittedAt: restaurantData.submittedAt,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            read: false,
            priority: 'high',
            message: `New restaurant "${restaurantData.name}" has submitted documents for approval`,
          });

        console.log(
          `✅ Admin notified about restaurant: ${restaurantData.name}`,
        );
      } catch (error) {
        console.error('❌ Failed to notify admin:', error);
      }
    }

    return null;
  });

// Helper function to send admin email using MailerSend HTTP API
async function sendAdminEmailWithYahoo(restaurant: any, actionToken: string) {
  const https = require('https');
  const adminEmail = 'samansaeedi102@gmail.com';

  const funcBase = 'https://us-central1-keetchen-c8e65.cloudfunctions.net/adminRestaurantAction';
  const approveUrl = `${funcBase}?action=approve&restaurantId=${encodeURIComponent(restaurant.id)}&token=${actionToken}`;
  const makeRejectUrl = (r: string) => `${funcBase}?action=reject&restaurantId=${encodeURIComponent(restaurant.id)}&token=${actionToken}&reason=${encodeURIComponent(r)}`;
  const customRejectUrl = `${funcBase}?action=reject&restaurantId=${encodeURIComponent(restaurant.id)}&token=${actionToken}`;

  const subject = `🏪 New Restaurant Pending Approval - ${restaurant.name}`;
  const html = `
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
                  restaurant.submittedAt,
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

          <div style="background-color: #e8f5e9; border: 1px solid #c8e6c9; border-radius: 8px; padding: 25px; margin-bottom: 25px;">
            <h3 style="color: #1b5e20; margin: 0 0 8px 0; font-size: 18px;">🚦 Quick Actions</h3>
            <p style="color: #2e7d32; margin: 0 0 16px 0; font-size: 14px;">Review the documents above, then approve or reject directly from this email.</p>

            <a href="${approveUrl}"
               style="display: block; background: #28a745; color: white; padding: 14px 20px; text-decoration: none; border-radius: 8px; font-weight: bold; text-align: center; font-size: 16px; margin-bottom: 20px;">
              ✅ Approve Restaurant
            </a>

            <p style="font-weight: bold; color: #495057; margin: 0 0 10px 0; font-size: 13px;">❌ Reject with preset reason:</p>

            <a href="${makeRejectUrl('Business license expired - please upload a valid license')}"
               style="display: block; background: #fff3e0; color: #e65100; padding: 10px 14px; text-decoration: none; border-radius: 6px; font-size: 13px; margin-bottom: 6px; border: 1px solid #ffe0b2;">
              📄 Business license expired
            </a>
            <a href="${makeRejectUrl('Documents are not clear - please upload higher quality images')}"
               style="display: block; background: #fff3e0; color: #e65100; padding: 10px 14px; text-decoration: none; border-radius: 6px; font-size: 13px; margin-bottom: 6px; border: 1px solid #ffe0b2;">
              🔍 Documents not clear / low quality
            </a>
            <a href="${makeRejectUrl('Sanitary certification appears to be expired')}"
               style="display: block; background: #fff3e0; color: #e65100; padding: 10px 14px; text-decoration: none; border-radius: 6px; font-size: 13px; margin-bottom: 6px; border: 1px solid #ffe0b2;">
              🏥 Sanitary certification expired
            </a>
            <a href="${makeRejectUrl('Work permit is not readable - please upload a clearer document')}"
               style="display: block; background: #fff3e0; color: #e65100; padding: 10px 14px; text-decoration: none; border-radius: 6px; font-size: 13px; margin-bottom: 6px; border: 1px solid #ffe0b2;">
              🛂 Work permit not readable
            </a>
            <a href="${makeRejectUrl('Restaurant address does not match business license address')}"
               style="display: block; background: #fff3e0; color: #e65100; padding: 10px 14px; text-decoration: none; border-radius: 6px; font-size: 13px; margin-bottom: 6px; border: 1px solid #ffe0b2;">
              📍 Address mismatch
            </a>
            <a href="${customRejectUrl}"
               style="display: block; background: #fce4ec; color: #c62828; padding: 10px 14px; text-decoration: none; border-radius: 6px; font-size: 13px; border: 1px solid #ef9a9a; font-weight: bold;">
              ✏️ Reject with custom reason…
            </a>
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
    `;

  const body = JSON.stringify({
    from: {email: 'noreply@keetchen.app', name: 'Keetchen'},
    to: [{email: adminEmail}],
    subject,
    html,
  });

  await new Promise<void>((resolve, reject) => {
    const request = https.request(
      {
        hostname: 'api.mailersend.com',
        path: '/v1/email',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${MAILERSEND_API_KEY.value()}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (response: any) => {
        let data = '';
        response.on('data', (chunk: any) => {
          data += chunk;
        });
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve();
          } else {
            reject(
              new Error(`MailerSend API error ${response.statusCode}: ${data}`),
            );
          }
        });
      },
    );
    request.on('error', reject);
    request.write(body);
    request.end();
  });

  console.log('✅ Admin email sent via MailerSend to:', adminEmail);
}

// HTTPS endpoint — handles admin approve/reject actions clicked from the notification email
// GET  ?action=approve|reject&restaurantId=X&token=Y[&reason=...] → confirmation/form page
// POST {action, restaurantId, token, reason?}                     → executes action, shows result
export const adminRestaurantAction = functions.https.onRequest(async (req: any, res: any) => {
  const escHtml = (s: any) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const resultPage = (title: string, emoji: string, heading: string, body: string, color: string) => `
    <!DOCTYPE html><html lang="en"><head>
      <meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
      <title>${title}</title>
      <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}.card{background:white;border-radius:16px;padding:40px 32px;max-width:480px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}.emoji{font-size:64px;margin-bottom:20px}h1{color:${color};font-size:24px;margin-bottom:12px}p{color:#666;font-size:16px;line-height:1.5}.hint{margin-top:24px;font-size:14px;color:#999}</style>
    </head><body><div class="card">
      <div class="emoji">${emoji}</div><h1>${heading}</h1><p>${body}</p>
      <p class="hint">You can close this page.</p>
    </div></body></html>`;

  const token = (String((req.method === 'GET' ? req.query.token : req.body?.token) || '')).trim();
  const restaurantId = (String((req.method === 'GET' ? req.query.restaurantId : req.body?.restaurantId) || '')).trim();
  const action = (String((req.method === 'GET' ? req.query.action : req.body?.action) || '')).trim();
  const reason = (String((req.method === 'GET' ? req.query.reason : req.body?.reason) || '')).trim();

  if (!token || !restaurantId || !action) {
    res.status(400).send(resultPage('Error', '❌', 'Invalid Link', 'This link is missing required parameters.', '#e53935'));
    return;
  }

  // Validate token
  const db = admin.firestore();
  const tokenRef = db.collection('adminActionTokens').doc(token);
  let tokenData: any;
  try {
    const tokenSnap = await tokenRef.get();
    if (!tokenSnap.exists) {
      res.status(400).send(resultPage('Invalid Link', '❌', 'Invalid Link', 'This action link is invalid or does not exist.', '#e53935'));
      return;
    }
    tokenData = tokenSnap.data();
    if (tokenData.used) {
      res.send(resultPage('Already Actioned', '✅', 'Already Actioned', `This restaurant was already ${tokenData.action || 'actioned'}. No changes were made.`, '#43a047'));
      return;
    }
    if (tokenData.expiresAt < Date.now()) {
      res.status(400).send(resultPage('Link Expired', '⏰', 'Link Expired', 'This action link has expired (valid for 7 days). Please use the Firestore console directly.', '#fb8c00'));
      return;
    }
    if (tokenData.restaurantId !== restaurantId) {
      res.status(400).send(resultPage('Error', '❌', 'Invalid Link', 'Token does not match this restaurant.', '#e53935'));
      return;
    }
  } catch (e: any) {
    res.status(500).send(resultPage('Error', '❌', 'Something went wrong', 'Please try again.', '#e53935'));
    return;
  }

  // Fetch restaurant name for display
  let restaurantName = restaurantId;
  try {
    const userSnap = await db.collection('users').doc(restaurantId).get();
    if (userSnap.exists) {
      const d: any = userSnap.data();
      restaurantName = `${d.name || ''} ${d.lastName || ''}`.trim() || restaurantId;
    }
  } catch (_) {}

  const cardStyle = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}.card{background:white;border-radius:16px;padding:36px 32px;max-width:500px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,.08)}`;

  // ── GET: show confirmation or reject form ────────────────────────────────
  if (req.method === 'GET') {
    if (action === 'approve') {
      res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Approve Restaurant</title>
<style>${cardStyle}h1{color:#1b5e20;font-size:22px;margin-bottom:10px;text-align:center}.sub{color:#555;margin-bottom:20px;font-size:15px;text-align:center}.name{font-weight:bold}button{display:block;width:100%;padding:14px;background:#28a745;color:white;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer}button:disabled{opacity:.6}.cancel{margin-top:12px;font-size:13px;color:#999;text-align:center}</style>
</head><body><div class="card">
  <div style="font-size:56px;margin-bottom:16px;text-align:center">✅</div>
  <h1>Approve Restaurant?</h1>
  <p class="sub">You are about to approve <span class="name">${escHtml(restaurantName)}</span>.<br/>They will be notified and can start listing food items.</p>
  <form method="POST" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Processing…'">
    <input type="hidden" name="action" value="approve"/>
    <input type="hidden" name="restaurantId" value="${escHtml(restaurantId)}"/>
    <input type="hidden" name="token" value="${escHtml(token)}"/>
    <button type="submit">✅ Confirm Approval</button>
  </form>
  <p class="cancel">Close this tab to cancel.</p>
</div></body></html>`);

    } else if (action === 'reject') {
      if (reason) {
        // Confirm page with pre-filled reason
        res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Reject Restaurant</title>
<style>${cardStyle}h1{color:#b71c1c;font-size:22px;margin-bottom:10px;text-align:center}.sub{color:#555;margin-bottom:12px;font-size:15px;text-align:center}.reason-box{background:#fff3e0;border:1px solid #ffe0b2;border-radius:8px;padding:12px 16px;margin:12px 0;color:#e65100;font-style:italic;font-size:14px}button{display:block;width:100%;padding:14px;background:#e53935;color:white;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;margin-top:16px}button:disabled{opacity:.6}.cancel{margin-top:12px;font-size:13px;color:#999;text-align:center}</style>
</head><body><div class="card">
  <div style="font-size:56px;margin-bottom:16px;text-align:center">❌</div>
  <h1>Reject Restaurant?</h1>
  <p class="sub">You are about to reject <strong>${escHtml(restaurantName)}</strong> with the reason:</p>
  <div class="reason-box">&ldquo;${escHtml(reason)}&rdquo;</div>
  <p style="font-size:13px;color:#888;text-align:center">The restaurant will receive an email with this reason.</p>
  <form method="POST" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Processing…'">
    <input type="hidden" name="action" value="reject"/>
    <input type="hidden" name="restaurantId" value="${escHtml(restaurantId)}"/>
    <input type="hidden" name="token" value="${escHtml(token)}"/>
    <input type="hidden" name="reason" value="${escHtml(reason)}"/>
    <button type="submit">❌ Confirm Rejection</button>
  </form>
  <p class="cancel">Close this tab to cancel.</p>
</div></body></html>`);
      } else {
        // Rejection form with preset reasons + custom input
        const presets = [
          'Business license expired - please upload a valid license',
          'Documents are not clear - please upload higher quality images',
          'Sanitary certification appears to be expired',
          'Work permit is not readable - please upload a clearer document',
          'Restaurant address does not match business license address',
        ];
        const presetBtns = presets.map(r =>
          `<button type="button" class="preset" onclick="pick(this)" data-r="${escHtml(r)}">${escHtml(r)}</button>`
        ).join('');
        res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Reject Restaurant</title>
<style>${cardStyle}h1{color:#b71c1c;font-size:22px;margin-bottom:8px;text-align:center}.sub{color:#555;margin-bottom:16px;font-size:14px;text-align:center}.preset{display:block;width:100%;padding:10px 14px;background:#fff3e0;color:#e65100;border:1px solid #ffe0b2;border-radius:6px;font-size:13px;cursor:pointer;text-align:left;margin-bottom:7px}.preset.sel,.preset:hover{background:#ffe0b2}label{font-weight:600;color:#444;font-size:13px;display:block;margin:14px 0 6px}textarea{width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;resize:vertical}textarea:focus{border-color:#e53935;outline:none}button.go{display:block;width:100%;padding:14px;background:#e53935;color:white;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;margin-top:12px}button.go:disabled{opacity:.6}.cancel{margin-top:12px;font-size:13px;color:#999;text-align:center}</style>
</head><body><div class="card">
  <div style="font-size:48px;margin-bottom:12px;text-align:center">❌</div>
  <h1>Reject: ${escHtml(restaurantName)}</h1>
  <p class="sub">Select a preset reason or write a custom one.</p>
  <div>${presetBtns}</div>
  <form method="POST" onsubmit="return go(this)">
    <input type="hidden" name="action" value="reject"/>
    <input type="hidden" name="restaurantId" value="${escHtml(restaurantId)}"/>
    <input type="hidden" name="token" value="${escHtml(token)}"/>
    <label>Or write a custom reason:</label>
    <textarea name="reason" id="rt" rows="3" placeholder="Enter rejection reason…" required></textarea>
    <button type="submit" class="go">❌ Reject Restaurant</button>
  </form>
  <p class="cancel">Close this tab to cancel.</p>
</div>
<script>
function pick(b){document.getElementById('rt').value=b.dataset.r;document.querySelectorAll('.preset').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');}
function go(f){if(!f.reason.value.trim()){alert('Please enter a rejection reason.');return false;}f.querySelector('.go').disabled=true;f.querySelector('.go').textContent='Processing…';return true;}
</script>
</body></html>`);
      }
    } else {
      res.status(400).send(resultPage('Error', '❌', 'Unknown Action', 'This action is not supported.', '#e53935'));
    }
    return;
  }

  // ── POST: execute the action ─────────────────────────────────────────────
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

  try {
    if (action === 'approve') {
      await db.collection('users').doc(restaurantId).update({
        'certification.status': 'certified',
        'certification.documentsStatus': 'approved',
        'certification.verifiedAt': new Date().toISOString(),
        'certification.verifiedBy': 'admin_email',
        'certification.rejectionReason': admin.firestore.FieldValue.delete(),
        'certification.notes': 'Restaurant approved by admin via email',
      });
      await tokenRef.update({used: true, usedAt: admin.firestore.FieldValue.serverTimestamp(), action: 'approved'});
      console.log(`[adminRestaurantAction] Approved restaurant ${restaurantId}`);
      res.send(resultPage('Approved!', '✅', 'Restaurant Approved!', `${escHtml(restaurantName)} has been approved and will be notified automatically.`, '#1b5e20'));

    } else if (action === 'reject') {
      if (!reason) {
        res.status(400).send(resultPage('Error', '❌', 'Reason Required', 'A rejection reason is required. Please go back and enter one.', '#e53935'));
        return;
      }
      await db.collection('users').doc(restaurantId).update({
        'certification.status': 'rejected',
        'certification.documentsStatus': 'rejected',
        'certification.rejectionReason': reason,
        'certification.verifiedAt': new Date().toISOString(),
        'certification.verifiedBy': 'admin_email',
      });
      await tokenRef.update({used: true, usedAt: admin.firestore.FieldValue.serverTimestamp(), action: 'rejected', rejectionReason: reason});
      console.log(`[adminRestaurantAction] Rejected restaurant ${restaurantId}: ${reason}`);
      res.send(resultPage('Rejected', '❌', 'Restaurant Rejected', `${escHtml(restaurantName)} has been rejected. They will be notified automatically.`, '#b71c1c'));

    } else {
      res.status(400).send(resultPage('Error', '❌', 'Unknown Action', 'This action is not supported.', '#e53935'));
    }
  } catch (err: any) {
    console.error('[adminRestaurantAction] error', err);
    res.status(500).send(resultPage('Error', '❌', 'Something went wrong', err?.message || 'Please try again or use the Firestore console.', '#e53935'));
  }
});

// Send email notification to vendor when admin approves/rejects restaurant
export const notifyVendorCertificationUpdate = functions
  .runWith({secrets: [MAILERSEND_API_KEY]})
  .firestore.document('users/{userId}')
  .onUpdate(async (change, context) => {
    console.log('Vendor certification update notification triggered!');

    const before = change.before.data();
    const after = change.after.data();
    const userId = context.params.userId;

    // Check if this is a restaurant certification status change
    if (
      after.role === 'vendor' &&
      after.type === 'restaurant' &&
      before.certification?.status !== after.certification?.status &&
      (after.certification?.status === 'certified' ||
        after.certification?.status === 'rejected')
    ) {
      console.log(
        `Restaurant ${userId} certification status changed to: ${after.certification.status}`,
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
          `✅ Vendor notified about certification: ${restaurantData.status}`,
        );
      } catch (error) {
        console.error('❌ Failed to notify vendor:', error);
      }
    }

    return null;
  });

// Helper function to send certification email to vendor via MailerSend
async function sendVendorCertificationEmail(restaurant: any) {
  const https = require('https');
  const isApproved = restaurant.status === 'certified';
  const subject = isApproved
    ? `🎉 Welcome to Keetchen - ${restaurant.name}`
    : `📄 Document Update Required - ${restaurant.name}`;

  const html = generateVendorEmailTemplate(restaurant, isApproved);

  const body = JSON.stringify({
    from: {email: 'noreply@keetchen.app', name: 'Keetchen'},
    to: [{email: restaurant.email}],
    subject,
    html,
  });

  await new Promise<void>((resolve, reject) => {
    const request = https.request(
      {
        hostname: 'api.mailersend.com',
        path: '/v1/email',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${MAILERSEND_API_KEY.value()}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (response: any) => {
        let data = '';
        response.on('data', (chunk: any) => {
          data += chunk;
        });
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve();
          } else {
            reject(
              new Error(`MailerSend API error ${response.statusCode}: ${data}`),
            );
          }
        });
      },
    );
    request.on('error', reject);
    request.write(body);
    request.end();
  });

  console.log(`✅ Vendor email sent via MailerSend to: ${restaurant.email}`);
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
                'Please review and resubmit your documents.'
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

export const releaseExpiredHolds = functions.pubsub
  .schedule('every 1 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    // Helper: choose a numeric field on a counter doc to increment
    function chooseNumericField(
      counterData: FirebaseFirestore.DocumentData | undefined,
    ) {
      if (!counterData) return null;
      const preferred = [
        'available',
        'remaining',
        'count',
        'qty',
        'capacity',
        'slots',
        'seats',
        'current',
        'reserved',
        'reservedCount',
      ];
      for (const p of preferred) {
        if (typeof counterData[p] === 'number') return p;
      }
      // fallback: pick any numeric field
      for (const k of Object.keys(counterData)) {
        if (typeof counterData[k] === 'number') return k;
      }
      return null;
    }

    // Process one collection (orders/bookings)
    async function processCollection(collectionPath: string) {
      const batchSize = 300;
      let lastSnapshotSize = 0;

      // Query loop to handle many expired docs in pages
      const queryBase = db
        .collection(collectionPath)
        .where('holdExpiresAt', '<=', now)
        .orderBy('holdExpiresAt')
        .limit(batchSize);

      let query = queryBase;
      while (true) {
        const snap = await query.get();
        if (snap.empty) break;

        lastSnapshotSize = snap.size;
        const promises = snap.docs.map(async doc => {
          const docRef = doc.ref;

          try {
            await db.runTransaction(async tx => {
              const fresh = await tx.get(docRef);
              if (!fresh.exists) return;
              const data = fresh.data() || {};

              // Skip if already released
              if (data.holdReleased) return;

              const holdExpiresAt = data.holdExpiresAt as
                | admin.firestore.Timestamp
                | undefined;
              if (!holdExpiresAt) return;
              if (holdExpiresAt.toMillis() > now.toMillis()) return; // not yet expired

              // Collect reservations: multiple shapes supported
              const reservations: Array<any> =
                data.holdCounterReservations ||
                data.holdCounterDocIds ||
                data.holdCounterDocs ||
                [];

              // If reservations is an object map, transform to array
              const reservationsArray = Array.isArray(reservations)
                ? reservations
                : Object.keys(reservations).map(k => reservations[k]);

              // Release each reservation by incrementing the best numeric field
              for (const r of reservationsArray) {
                // normalize to path + amount
                let counterPath: string | null = null;
                let amount = 1;

                if (typeof r === 'string') {
                  counterPath = r;
                } else if (typeof r === 'object' && r !== null) {
                  counterPath =
                    r.counterDocPath ||
                    r.counterPath ||
                    r.docPath ||
                    r.path ||
                    r.doc ||
                    null;
                  amount =
                    Number(r.amount || r.qty || r.count || r.reserved || 1) ||
                    1;
                }

                if (!counterPath) continue;
                const counterRef = db.doc(counterPath);

                // Read counter doc and pick a numeric field to increment
                const counterSnap = await tx.get(counterRef);
                if (!counterSnap.exists) {
                  // nothing to restore
                  continue;
                }
                const counterData = counterSnap.data();
                const numericField = chooseNumericField(counterData);

                if (numericField) {
                  const update: any = {};
                  update[numericField] =
                    admin.firestore.FieldValue.increment(amount);
                  tx.update(counterRef, update);
                } else {
                  // If no numeric field found, increment `available` by default
                  tx.update(counterRef, {
                    available: admin.firestore.FieldValue.increment(amount),
                  });
                }
              }

              // Mark doc as released and clear hold metadata (preserve audit trail)
              const updates: any = {
                holdReleased: true,
                holdReleasedAt: admin.firestore.FieldValue.serverTimestamp(),
                holdReleasedBy: 'system',
              };
              // remove hold fields if present
              if (data.holdExpiresAt !== undefined)
                updates['holdExpiresAt'] = admin.firestore.FieldValue.delete();
              if (data.holdCounterReservations !== undefined)
                updates['holdCounterReservations'] =
                  admin.firestore.FieldValue.delete();
              if (data.holdCounterDocIds !== undefined)
                updates['holdCounterDocIds'] =
                  admin.firestore.FieldValue.delete();
              if (data.holdCounterDocs !== undefined)
                updates['holdCounterDocs'] =
                  admin.firestore.FieldValue.delete();

              // Optionally move status when it was a pending hold
              if (
                data.status === 'pending' ||
                data.status === 'on_hold' ||
                data.status === 'hold'
              ) {
                // For orders, mark as 'expired' so UI can show expired state
                if (collectionPath === 'orders') {
                  updates['status'] = 'expired';
                  updates['expiredAt'] =
                    admin.firestore.FieldValue.serverTimestamp();
                  // Create mandatory notifications for both client and vendor
                  try {
                    const clientId = data.clientId || data.client || null;
                    const vendorId = data.vendorId || data.vendor || null;
                    const publicCode = data.publicCode || '';
                    const clientName =
                      (data.clientInfo && (data.clientInfo.name || '')) ||
                      data.clientName ||
                      '';

                    // Notification payload common fields
                    const notifBase: any = {
                      orderId: docRef.id,
                      publicCode: publicCode,
                      clientName: clientName,
                      expired: true,
                      expiryReason: 'hold_expired',
                      createdAt: admin.firestore.FieldValue.serverTimestamp(),
                      timestamp: admin.firestore.FieldValue.serverTimestamp(),
                      read: false,
                    };

                    // Avoid creating duplicate expiry notifications when a
                    // more-specific release job (e.g. pickup hold release)
                    // already marked the order with an expiration reason/hold.
                    const alreadyMarked =
                      data.expirationReason ||
                      data.expiryReason ||
                      data.holdType;
                    if (!alreadyMarked) {
                      try {
                        // Double-check: if a specialized expiry notification was
                        // already created for this order (slot/serving types),
                        // skip creating the generic `orderExpired` to avoid duplicates.
                        const specializedTypes = [
                          'order_expired_serving',
                          'order_expired_slot',
                        ];
                        const existing = await db
                          .collection('notifications')
                          .where('orderId', '==', docRef.id)
                          .where('type', 'in', specializedTypes)
                          .limit(1)
                          .get();

                        if (!existing.empty) {
                          console.log(
                            `Skipping generic orderExpired for ${docRef.path} because specialized notification already exists`,
                          );
                        } else {
                          if (clientId) {
                            const clientNotifRef = db
                              .collection('notifications')
                              .doc();
                            tx.set(clientNotifRef, {
                              userId: clientId,
                              type: 'orderExpired',
                              ...notifBase,
                            });
                          }

                          if (vendorId) {
                            const vendorNotifRef = db
                              .collection('notifications')
                              .doc();
                            tx.set(vendorNotifRef, {
                              userId: vendorId,
                              type: 'orderExpired',
                              vendorId: vendorId,
                              ...notifBase,
                            });
                          }
                        }
                      } catch (err) {
                        console.error(
                          'Error checking existing expiry notifications:',
                          err,
                        );
                      }
                    } else {
                      console.log(
                        `Skipping generic orderExpired for ${docRef.path} because specialized expiration exists`,
                      );
                    }
                  } catch (err) {
                    console.error(
                      'Failed to create expiry notifications:',
                      err,
                    );
                  }
                } else {
                  // For other collections (bookings) keep previous behaviour
                  updates['status'] = 'cancelled';
                  updates['cancellationReason'] = 'hold_expired';
                }
              }

              tx.update(docRef, updates);
            });
          } catch (err) {
            console.error(
              `Failed to release hold for ${collectionPath}/${doc.id}:`,
              err,
            );
          }
        });

        await Promise.all(promises);

        // Prepare next page: startAfter last doc
        const last = snap.docs[snap.docs.length - 1];
        query = queryBase.startAfter(last);
        if (snap.size < batchSize) break;
      }
      return lastSnapshotSize;
    }

    // Run for both collections
    try {
      const ordersProcessed = await processCollection('orders');
      const bookingsProcessed = await processCollection('bookings');
      console.log(
        `[releaseExpiredHolds] processed orders:${ordersProcessed} bookings:${bookingsProcessed}`,
      );
    } catch (err) {
      console.error('[releaseExpiredHolds] unexpected error:', err);
    }

    return null;
  });

// ============================================
// BOOKING SYSTEM CLOUD FUNCTIONS
// ============================================

// Notify vendor when a new booking is created
export const notifyVendorOnNewBooking = functions.firestore
  .document('bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    const booking = snap.data();
    if (!booking) return null;

    const vendorId = booking.vendorId;
    const clientName = booking.clientInfo?.name
      ? `${booking.clientInfo.name} ${booking.clientInfo.lastName || ''}`.trim()
      : 'Client';
    const bookingId = context.params.bookingId;
    const publicCode = booking.publicCode || bookingId.slice(-6).toUpperCase();
    const serviceType = booking.serviceType || 'table booking';

    if (!vendorId) {
      console.log('No vendor ID found for booking');
      return null;
    }

    // Check user preferences before creating notification
    const shouldSend = await shouldSendNotification(vendorId, 'newBooking');
    if (!shouldSend) {
      console.log(
        `Skipping new booking notification for vendor ${vendorId} - disabled in preferences`,
      );
      return null;
    }

    try {
      // Use NotificationService function for proper formatting
      await admin.firestore().collection('notifications').add({
        userId: vendorId,
        bookingId: bookingId,
        publicCode: publicCode,
        clientName: clientName,
        serviceType: serviceType,
        type: 'newBooking',
        archived: false,
        // Let client/localized UI render title/body from `type` + payload
        message: '',
        createdAt: new Date().toISOString(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });

      console.log(
        `New booking notification created for vendor ${vendorId}, booking ${bookingId}`,
      );
    } catch (error) {
      console.error('Error creating new booking notification:', error);
    }

    return null;
  });

// Notify client when booking status changes
export const notifyClientOnBookingStatusChange = functions.firestore
  .document('bookings/{bookingId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // Only proceed if status actually changed
    if (before.status === after.status) {
      return null;
    }

    const clientId = after.clientId;
    const bookingId = context.params.bookingId;

    if (!clientId) {
      console.log('No client ID found for booking');
      return null;
    }

    // Determine notification type based on new status
    let notificationType = '';

    switch (after.status) {
      case 'accepted':
        notificationType = 'bookingAccepted';
        break;
      case 'rejected':
        notificationType = 'bookingRejected';
        break;
      case 'cancelled':
        notificationType = 'bookingCancelled';
        break;
      case 'expired':
        notificationType = 'bookingExpired';
        break;
      case 'completed':
        notificationType = 'bookingCompleted';
        break;
      default:
        console.log(
          `No notification needed for booking status: ${after.status}`,
        );
        return null;
    }

    // Expiry notifications are mandatory and should not be filtered by preferences
    let shouldProceed = true;
    if (notificationType !== 'bookingExpired') {
      const shouldSend = await shouldSendNotification(
        clientId,
        notificationType,
      );
      if (!shouldSend) {
        console.log(
          `Skipping ${notificationType} notification for client ${clientId} - disabled in preferences`,
        );
        shouldProceed = false;
      }
    }
    if (!shouldProceed) return null;

    try {
      const publicCode = after.publicCode || bookingId.slice(-6).toUpperCase();
      const date = after.date || '';
      const mealTime = after.mealTime || '';

      // Create notification data based on type
      let notificationData: any = {
        userId: clientId,
        bookingId: bookingId,
        publicCode: publicCode,
        type: notificationType,
        archived: false,
        createdAt: new Date().toISOString(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      };

      // Add type-specific data and message
      switch (notificationType) {
        case 'bookingAccepted':
          notificationData.deliveryDate = date;
          notificationData.mealTime = mealTime;
          break;
        case 'bookingRejected':
          notificationData.rejectionReason =
            after.rejectionReason || 'No reason provided';
          notificationData.message = '';
          break;
        case 'bookingCancelled':
          notificationData.cancellationReason =
            after.cancellationReason || 'No reason provided';
          break;
        case 'bookingExpired':
          // mandatory dynamic expiry payload (client and vendor will localize)
          notificationData.expired = true;
          notificationData.expiredAt =
            admin.firestore.FieldValue.serverTimestamp();
          notificationData.expiryReason = after.expiryReason || 'hold_expired';
          break;
        default:
          notificationData.message = `Your booking ${publicCode} status changed to ${after.status}`;
      }

      // Create notification for client
      await admin.firestore().collection('notifications').add(notificationData);

      // Also create a mandatory vendor notification for expiry events
      if (notificationType === 'bookingExpired') {
        try {
          const vendorId = after.vendorId || after.vendor || null;
          if (vendorId) {
            const vendorNotif: any = {
              userId: vendorId,
              type: 'bookingExpired',
              bookingId: bookingId,
              publicCode: publicCode,
              clientName: after.clientInfo?.name || after.clientName || '',
              expired: true,
              expiredAt: admin.firestore.FieldValue.serverTimestamp(),
              expiryReason: after.expiryReason || 'hold_expired',
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              read: false,
            };
            await admin
              .firestore()
              .collection('notifications')
              .add(vendorNotif);
          }
        } catch (err) {
          console.error(
            'Failed to create vendor bookingExpired notification:',
            err,
          );
        }
      }

      console.log(
        `${notificationType} notification created for client ${clientId}, booking ${bookingId}`,
      );
    } catch (error) {
      console.error(`Error creating ${notificationType} notification:`, error);
    }

    return null;
  });

// Notify client when their booking is cancelled due to order conflict
export const notifyClientOnBookingCancellation = functions.firestore
  .document('bookings/{bookingId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // Only proceed if booking was cancelled due to conflict
    if (
      before.status !== 'cancelled' &&
      after.status === 'cancelled' &&
      after.cancellationReason === 'order_conflict'
    ) {
      const clientId = after.clientId;
      const bookingId = context.params.bookingId;

      if (!clientId) return null;

      // Check user preferences
      const shouldSend = await shouldSendNotification(
        clientId,
        'bookingConflictCancellation',
      );
      if (!shouldSend) {
        console.log(
          `Skipping booking conflict notification for client ${clientId} - disabled in preferences`,
        );
        return null;
      }

      try {
        await admin
          .firestore()
          .collection('notifications')
          .add({
            userId: clientId,
            type: 'bookingConflictCancellation',
            bookingId: bookingId,
            bookingDate: after.date,
            tableNumber: after.tableNumber,
            vendorId: after.vendorId,
            conflictOrderId: after.conflictOrderId || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            read: false,
          });

        console.log(
          `Booking conflict cancellation notification created for client ${clientId}`,
        );
      } catch (error) {
        console.error('Error creating booking conflict notification:', error);
      }
    }

    return null;
  });

// Update booking statistics when booking status changes
export const updateBookingStatistics = functions.firestore
  .document('bookings/{bookingId}')
  .onWrite(async (change, context) => {
    console.log('Booking statistics update triggered!');

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
      console.log('No vendor ID found for booking');
      return null;
    }

    try {
      const vendorRef = admin.firestore().collection('users').doc(vendorId);
      const vendorDoc = await vendorRef.get();
      const vendorData = vendorDoc.data();

      if (!vendorData) {
        console.log('Vendor not found');
        return null;
      }

      // Initialize booking statistics if they don't exist
      const bookingStats = vendorData.bookingStatistics || {
        totalBookings: 0,
        acceptedBookings: 0,
        completedBookings: 0,
        cancelledBookings: 0,
        rejectedBookings: 0,
        expiredBookings: 0,
      };

      // Handle booking deletion
      if (!afterData) {
        if (beforeStatus === 'accepted') {
          bookingStats.acceptedBookings = Math.max(
            0,
            (bookingStats.acceptedBookings || 0) - 1,
          );
        }
        if (beforeStatus === 'completed') {
          bookingStats.completedBookings = Math.max(
            0,
            (bookingStats.completedBookings || 0) - 1,
          );
        }
        if (beforeStatus === 'cancelled') {
          bookingStats.cancelledBookings = Math.max(
            0,
            (bookingStats.cancelledBookings || 0) - 1,
          );
        }
        if (beforeStatus === 'rejected') {
          bookingStats.rejectedBookings = Math.max(
            0,
            (bookingStats.rejectedBookings || 0) - 1,
          );
        }
        if (beforeStatus === 'expired') {
          bookingStats.expiredBookings = Math.max(
            0,
            (bookingStats.expiredBookings || 0) - 1,
          );
        }
        bookingStats.totalBookings = Math.max(
          0,
          (bookingStats.totalBookings || 0) - 1,
        );

        await vendorRef.update({
          bookingStatistics: bookingStats,
          lastBookingUpdate: admin.firestore.FieldValue.serverTimestamp(),
        });
        return null;
      }

      // Status transitions for new bookings
      if (!beforeData) {
        bookingStats.totalBookings = (bookingStats.totalBookings || 0) + 1;
        if (afterStatus === 'expired') {
          bookingStats.expiredBookings =
            (bookingStats.expiredBookings || 0) + 1;
        }
      }

      // Handle status changes
      if (afterStatus === 'accepted' && beforeStatus !== 'accepted') {
        bookingStats.acceptedBookings =
          (bookingStats.acceptedBookings || 0) + 1;
      }
      if (afterStatus === 'completed' && beforeStatus !== 'completed') {
        bookingStats.completedBookings =
          (bookingStats.completedBookings || 0) + 1;
      }
      if (afterStatus === 'cancelled' && beforeStatus !== 'cancelled') {
        bookingStats.cancelledBookings =
          (bookingStats.cancelledBookings || 0) + 1;
      }
      if (afterStatus === 'rejected' && beforeStatus !== 'rejected') {
        bookingStats.rejectedBookings =
          (bookingStats.rejectedBookings || 0) + 1;
      }
      if (afterStatus === 'expired' && beforeStatus !== 'expired') {
        bookingStats.expiredBookings = (bookingStats.expiredBookings || 0) + 1;
      }

      // Handle status reversions
      if (beforeStatus === 'accepted' && afterStatus !== 'accepted') {
        bookingStats.acceptedBookings = Math.max(
          0,
          (bookingStats.acceptedBookings || 0) - 1,
        );
      }
      if (beforeStatus === 'completed' && afterStatus !== 'completed') {
        bookingStats.completedBookings = Math.max(
          0,
          (bookingStats.completedBookings || 0) - 1,
        );
      }
      if (beforeStatus === 'cancelled' && afterStatus !== 'cancelled') {
        bookingStats.cancelledBookings = Math.max(
          0,
          (bookingStats.cancelledBookings || 0) - 1,
        );
      }
      if (beforeStatus === 'rejected' && afterStatus !== 'rejected') {
        bookingStats.rejectedBookings = Math.max(
          0,
          (bookingStats.rejectedBookings || 0) - 1,
        );
      }
      if (beforeStatus === 'expired' && afterStatus !== 'expired') {
        bookingStats.expiredBookings = Math.max(
          0,
          (bookingStats.expiredBookings || 0) - 1,
        );
      }

      await vendorRef.update({
        bookingStatistics: bookingStats,
        lastBookingUpdate: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(
        `Updated vendor ${vendorId} booking statistics:`,
        bookingStats,
      );
    } catch (error) {
      console.error('Error updating booking statistics:', error);
    }

    return null;
  });

// Notify clients of upcoming bookings (runs daily at 8 AM)
export const notifyClientsOfUpcomingBookings = functions.pubsub
  .schedule('every day 08:00')
  .timeZone('UTC')
  .onRun(async _context => {
    const db = admin.firestore();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    // Query bookings for tomorrow with status accepted
    const bookingsSnap = await db
      .collection('bookings')
      .where('date', '>=', today.toISOString())
      .where('date', '<=', tomorrow.toISOString())
      .where('status', '==', 'accepted')
      .get();

    if (bookingsSnap.empty) {
      console.log('No upcoming bookings found.');
      return null;
    }

    const notifications: any[] = [];

    for (const doc of bookingsSnap.docs) {
      const booking = doc.data();
      const clientId = booking.clientId;
      if (!clientId) continue;

      // Check if a reminder notification already exists
      const existing = await db
        .collection('notifications')
        .where('userId', '==', clientId)
        .where('type', '==', 'bookingReminder')
        .where('bookingId', '==', doc.id)
        .get();
      if (!existing.empty) continue;

      // Check user preferences
      const shouldSend = await shouldSendNotification(
        clientId,
        'bookingReminder',
      );
      if (!shouldSend) continue;

      notifications.push({
        userId: clientId,
        type: 'bookingReminder',
        bookingId: doc.id,
        bookingDate: booking.date,
        tableNumber: booking.tableNumber,
        numberOfGuests: booking.numberOfGuests,
        vendorId: booking.vendorId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });
    }

    // Batch create notifications
    if (notifications.length > 0) {
      const batch = db.batch();
      notifications.forEach(notif => {
        const ref = db.collection('notifications').doc();
        batch.set(ref, notif);
      });
      await batch.commit();
      console.log(
        `Created ${notifications.length} booking reminder notifications.`,
      );
    }

    return null;
  });

// Notify vendors of upcoming bookings (runs daily at 8 AM)
export const notifyVendorsOfUpcomingBookings = functions.pubsub
  .schedule('every day 08:00')
  .timeZone('UTC')
  .onRun(async _context => {
    const db = admin.firestore();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    // Query bookings for tomorrow with status accepted
    const bookingsSnap = await db
      .collection('bookings')
      .where('date', '>=', today.toISOString())
      .where('date', '<=', tomorrow.toISOString())
      .where('status', '==', 'accepted')
      .get();

    if (bookingsSnap.empty) {
      console.log('No upcoming vendor bookings found.');
      return null;
    }

    // Group bookings by vendor
    const vendorBookings: {[vendorId: string]: any[]} = {};

    bookingsSnap.docs.forEach(doc => {
      const booking = doc.data();
      const vendorId = booking.vendorId;
      if (vendorId) {
        if (!vendorBookings[vendorId]) {
          vendorBookings[vendorId] = [];
        }
        vendorBookings[vendorId].push({id: doc.id, ...booking});
      }
    });

    const notifications: any[] = [];

    for (const [vendorId, bookings] of Object.entries(vendorBookings)) {
      // Check if a reminder notification already exists for this vendor today
      const existing = await db
        .collection('notifications')
        .where('userId', '==', vendorId)
        .where('type', '==', 'vendorBookingReminder')
        .where('timestamp', '>=', today)
        .get();
      if (!existing.empty) continue;

      // Check user preferences
      const shouldSend = await shouldSendNotification(
        vendorId,
        'vendorBookingReminder',
      );
      if (!shouldSend) continue;

      notifications.push({
        userId: vendorId,
        type: 'vendorBookingReminder',
        bookingCount: bookings.length,
        bookingIds: bookings.map(b => b.id),
        bookingDate: bookings[0].date,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });
    }

    // Batch create notifications
    if (notifications.length > 0) {
      const batch = db.batch();
      notifications.forEach(notif => {
        const ref = db.collection('notifications').doc();
        batch.set(ref, notif);
      });
      await batch.commit();
      console.log(
        `Created ${notifications.length} vendor booking reminder notifications.`,
      );
    }

    return null;
  });

// Auto-complete bookings that have passed their date (runs daily at midnight)
export const autoCompleteExpiredBookings = functions.pubsub
  .schedule('0 0 * * *')
  .timeZone('UTC')
  .onRun(async _context => {
    console.log('Auto-completing expired bookings...');

    const db = admin.firestore();
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    yesterday.setHours(23, 59, 59, 999);

    try {
      // Find accepted bookings that are past their date
      const expiredBookingsQuery = db
        .collection('bookings')
        .where('status', '==', 'accepted')
        .where('date', '<=', yesterday.toISOString())
        .limit(500); // Process in batches

      const snapshot = await expiredBookingsQuery.get();

      if (snapshot.empty) {
        console.log('No expired bookings to complete');
        return;
      }

      const batch = db.batch();
      let count = 0;

      snapshot.forEach(doc => {
        batch.update(doc.ref, {
          status: 'completed',
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          completedReason: 'auto_completed_expired',
        });
        count++;
      });

      await batch.commit();
      console.log(`Auto-completed ${count} expired bookings`);

      // Create notifications for clients to review their completed bookings
      const reviewNotifications: any[] = [];
      for (const doc of snapshot.docs) {
        const booking = doc.data();
        const clientId = booking.clientId;
        const vendorId = booking.vendorId;

        if (clientId && vendorId) {
          // Check user preferences
          const shouldSend = await shouldSendNotification(
            clientId,
            'request_booking_review',
          );
          if (shouldSend) {
            reviewNotifications.push({
              userId: clientId,
              type: 'request_booking_review',
              bookingId: doc.id,
              vendorId: vendorId,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              read: false,
            });
          }
        }
      }

      // Batch create review notifications
      if (reviewNotifications.length > 0) {
        const reviewBatch = db.batch();
        reviewNotifications.forEach(notif => {
          const ref = db.collection('notifications').doc();
          reviewBatch.set(ref, notif);
        });
        await reviewBatch.commit();
        console.log(
          `Created ${reviewNotifications.length} booking review notifications`,
        );
      }
    } catch (error) {
      console.error('Error auto-completing expired bookings:', error);
    }

    return null;
  });

// Clean up old completed bookings (runs weekly on Sundays at 3 AM)
export const cleanupOldBookings = functions.pubsub
  .schedule('0 3 * * 0')
  .timeZone('UTC')
  .onRun(async _context => {
    console.log('Cleaning up old bookings...');

    const db = admin.firestore();
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    try {
      const oldBookingsQuery = db
        .collection('bookings')
        .where('status', 'in', ['completed', 'cancelled', 'rejected'])
        .where('date', '<', sixtyDaysAgo.toISOString())
        .limit(500); // Process in batches

      const snapshot = await oldBookingsQuery.get();

      if (snapshot.empty) {
        console.log('No old bookings to clean up');
        return;
      }

      const batch = db.batch();
      let count = 0;

      snapshot.forEach(doc => {
        batch.delete(doc.ref);
        count++;
      });

      await batch.commit();
      console.log(`Deleted ${count} old bookings`);
    } catch (error) {
      console.error('Error cleaning up old bookings:', error);
    }

    return null;
  });

// Notify client to review booking after completion
export const notifyClientToReviewBooking = functions.firestore
  .document('bookings/{bookingId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // Only proceed if status changed to 'completed'
    if (before.status === after.status || after.status !== 'completed') {
      return null;
    }

    // Get clientId and vendorId
    const clientId = after.clientId;
    const vendorId = after.vendorId;
    if (!clientId || !vendorId) return null;

    // Check user preferences
    const shouldSend = await shouldSendNotification(
      clientId,
      'request_booking_review',
    );
    if (!shouldSend) {
      console.log(
        `Skipping request_booking_review notification for client ${clientId} - disabled in preferences`,
      );
      return null;
    }

    // Create a notification for the client to review the booking
    await admin.firestore().collection('notifications').add({
      userId: clientId,
      type: 'request_booking_review',
      vendorId: vendorId,
      bookingId: context.params.bookingId,
      bookingDate: after.date,
      tableNumber: after.tableNumber,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      read: false,
    });

    console.log(`Created booking review request for client ${clientId}`);
    return null;
  });

// Update notification preferences to include booking-related notifications
export const updateNotificationPreferencesForBookings = functions.https.onCall(
  async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'User must be authenticated',
      );
    }

    const userId = context.auth.uid;
    const {bookingNotifications = true} = data;

    try {
      await admin.firestore().collection('users').doc(userId).update({
        'notificationPreferences.newBooking': bookingNotifications,
        'notificationPreferences.bookingAccepted': bookingNotifications,
        'notificationPreferences.bookingRejected': bookingNotifications,
        'notificationPreferences.bookingCancelled': bookingNotifications,
        'notificationPreferences.bookingCompleted': bookingNotifications,
        'notificationPreferences.bookingReminder': bookingNotifications,
        'notificationPreferences.vendorBookingReminder': bookingNotifications,
        'notificationPreferences.bookingConflictCancellation':
          bookingNotifications,
        'notificationPreferences.request_booking_review': bookingNotifications,
      });

      return {success: true};
    } catch (error) {
      console.error('Error updating booking notification preferences:', error);
      throw new functions.https.HttpsError(
        'internal',
        'Failed to update notification preferences',
      );
    }
  },
);

// Release expired pickup slot holds and cancel pending orders
export const releaseExpiredPickupHolds = functions.pubsub
  .schedule('every 1 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      const nowTs = admin.firestore.Timestamp.now();
      console.log(
        `🔄 Checking for expired pickup holds at ${nowTs
          .toDate()
          .toISOString()}`,
      );

      // Find expired holds (compare Timestamps)
      const expiredHoldsQuery = await admin
        .firestore()
        .collection('pickupSlotHolds')
        .where('status', '==', 'active')
        .where('holdExpiresAt', '<=', nowTs)
        .get();

      if (expiredHoldsQuery.empty) {
        console.log('✅ No expired pickup holds found');
        return null;
      }

      console.log(`🔍 Found ${expiredHoldsQuery.size} expired pickup holds`);

      const batch = admin.firestore().batch();
      let releasedCount = 0;
      let expiredOrdersCount = 0;

      for (const holdDoc of expiredHoldsQuery.docs) {
        const hold = holdDoc.data();

        // Mark hold as expired
        batch.update(holdDoc.ref, {
          status: 'expired',
          expiredAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Find and cancel pending orders that were holding this slot or serving
        let pendingOrdersQuery: FirebaseFirestore.QuerySnapshot | null = null;

        if (hold.slotTime) {
          // slot-based holds: match by pickupTimeSlot + date
          pendingOrdersQuery = await admin
            .firestore()
            .collection('orders')
            .where('status', '==', 'pending')
            .where('deliveryMethod', '==', 'pickup')
            .where('pickupTimeSlot', '==', hold.slotTime)
            .where('selectedDate', '==', hold.date)
            .get();
        } else {
          // serving-based holds: match pending pickup orders on the date
          // optionally filter by mealTime if present on the hold
          // For serving-based holds we must consider orders regardless of deliveryMethod
          // (servings apply across pickup and delivery). Do not filter by deliveryMethod here.
          let q: FirebaseFirestore.Query = admin
            .firestore()
            .collection('orders')
            .where('status', '==', 'pending')
            .where('selectedDate', '==', hold.date);

          if (hold.mealTime) {
            q = q.where('selectedMealTime', '==', hold.mealTime);
          }

          pendingOrdersQuery = await q.get();
        }

        // Cancel the pending orders (if any)
        if (pendingOrdersQuery && !pendingOrdersQuery.empty) {
          for (const orderDoc of pendingOrdersQuery.docs) {
            const order = orderDoc.data();

            // Check if this order contains the food item from the hold
            const hasMatchingItem = order.items?.some(
              (item: any) =>
                item.itemId === hold.foodItemId ||
                item.foodItemId === hold.foodItemId,
            );

            if (hasMatchingItem) {
              batch.update(orderDoc.ref, {
                status: 'expired',
                // Use a code-style expiration reason so clients can localize
                expirationReason: hold.slotTime
                  ? 'slot_hold_expired'
                  : 'serving_hold_expired',
                // Also write preferred `expiryReason` for consistency with notifications
                expiryReason: hold.slotTime
                  ? 'slot_hold_expired'
                  : 'serving_hold_expired',
                expiredAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              expiredOrdersCount++;
              // Client notification for expired orders is handled by the
              // central expiry flow elsewhere; do not create a duplicate
              // hold-specific notification here.

              // Create a vendor-facing notification so vendors are informed
              // when an order they were holding expires.
              try {
                if (order.vendorId) {
                  const vendorNotifRef = admin
                    .firestore()
                    .collection('notifications')
                    .doc();
                  batch.set(vendorNotifRef, {
                    userId: order.vendorId,
                    vendorId: order.vendorId,
                    orderId: orderDoc.id,
                    publicCode: order.publicCode || '',
                    type: 'orderExpired',
                    expired: true,
                    expiryReason: hold.slotTime
                      ? 'slot_hold_expired'
                      : 'serving_hold_expired',
                    expiredAt: admin.firestore.FieldValue.serverTimestamp(),
                    message: '',
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    read: false,
                    role: 'vendor',
                  });
                }
              } catch (err) {
                // Keep hold release best-effort; log and continue
                console.error('Error queuing vendor expiry notification:', err);
              }
            }
          }
        }

        releasedCount++;
      }

      // Commit all changes
      await batch.commit();

      console.log(
        `✅ Released ${releasedCount} expired pickup holds and expired ${expiredOrdersCount} orders`,
      );

      return {
        releasedHolds: releasedCount,
        expiredOrders: expiredOrdersCount,
        timestamp: nowTs.toDate().toISOString(),
      };
    } catch (error) {
      console.error('❌ Error in releaseExpiredPickupHolds:', error);
      throw error;
    }
  });

// Release expired booking holds and expire related pending bookings
export const releaseExpiredBookingHolds = functions.pubsub
  .schedule('every 1 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    try {
      console.log(
        `🔄 Checking for expired booking holds at ${now
          .toDate()
          .toISOString()}`,
      );

      // Find expired booking holds (compare Timestamps)
      const expiredHoldsQuery = await db
        .collection('bookingHolds')
        .where('status', '==', 'active')
        .where('holdExpiresAt', '<=', now)
        .get();

      if (expiredHoldsQuery.empty) {
        console.log('✅ No expired booking holds found');
        return null;
      }

      console.log(`🔍 Found ${expiredHoldsQuery.size} expired booking holds`);

      const batch = db.batch();
      let releasedCount = 0;
      let expiredBookingsCount = 0;

      for (const holdDoc of expiredHoldsQuery.docs) {
        const hold = holdDoc.data();

        // Mark hold as released
        batch.update(holdDoc.ref, {
          status: 'released',
          releasedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // If hold directly references a bookingId, expire that booking when still pending
        const bookingId = hold?.bookingId;
        if (bookingId) {
          const bookingRef = db.collection('bookings').doc(bookingId);
          const bookingSnap = await bookingRef.get();
          if (bookingSnap.exists) {
            const booking = bookingSnap.data();
            if (booking && booking.status === 'pending') {
              batch.update(bookingRef, {
                status: 'expired',
                expiredAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                cancellationReason: 'booking_hold_expired',
              });
              expiredBookingsCount++;

              // Notify client about expiration
              if (booking.clientId) {
                const notifRef = db.collection('notifications').doc();
                batch.set(notifRef, {
                  userId: booking.clientId,
                  type: 'bookingExpired',
                  bookingId: bookingId,
                  publicCode: booking.publicCode || '',
                  clientName:
                    booking.clientInfo?.name || booking.clientName || '',
                  expired: true,
                  expiryReason: 'booking_hold_expired',
                  expiredAt: admin.firestore.FieldValue.serverTimestamp(),
                  message: '',
                  createdAt: admin.firestore.FieldValue.serverTimestamp(),
                  timestamp: admin.firestore.FieldValue.serverTimestamp(),
                  read: false,
                });
              }
            }
          }
        } else {
          // Fallback: find bookings that reference this hold via bookingHoldId
          const q = await db
            .collection('bookings')
            .where('bookingHoldId', '==', holdDoc.id)
            .get();
          if (!q.empty) {
            for (const bdoc of q.docs) {
              const booking = bdoc.data();
              if (booking && booking.status === 'pending') {
                batch.update(bdoc.ref, {
                  status: 'expired',
                  expiredAt: admin.firestore.FieldValue.serverTimestamp(),
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                  cancellationReason: 'booking_hold_expired',
                });
                expiredBookingsCount++;

                if (booking.clientId) {
                  const notifRef = db.collection('notifications').doc();
                  batch.set(notifRef, {
                    userId: booking.clientId,
                    type: 'bookingExpired',
                    bookingId: bdoc.id,
                    publicCode: booking.publicCode || '',
                    clientName:
                      booking.clientInfo?.name || booking.clientName || '',
                    expired: true,
                    expiryReason: 'booking_hold_expired',
                    expiredAt: admin.firestore.FieldValue.serverTimestamp(),
                    message: '',
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    read: false,
                  });
                }
              }
            }
          }
        }

        releasedCount++;
      }

      // Commit batched updates
      await batch.commit();

      console.log(
        `✅ Released ${releasedCount} booking holds and expired ${expiredBookingsCount} bookings`,
      );

      return {
        releasedHolds: releasedCount,
        expiredBookings: expiredBookingsCount,
        timestamp: now.toDate().toISOString(),
      };
    } catch (error) {
      console.error('❌ Error in releaseExpiredBookingHolds:', error);
      throw error;
    }
  });

  // =====================
// Password reset endpoints
// =====================
// POST /sendPasswordReset { email, redirectUrl? }
// Creates a short-lived token stored in `password_resets` and emails
// a reset link containing the token to the user. The frontend should
// present a form that posts the token + newPassword to /resetPassword.
export const sendPasswordReset = functions.runWith({
  secrets: [MAILERSEND_API_KEY],
}).https.onRequest(async (req: any, res: any) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const {email, redirectUrl} = req.body || {};
    if (!email) {
      res.status(400).json({error: 'Missing email'});
      return;
    }

    // Lookup user by email
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (e: any) {
      // Don't reveal whether account exists — behave as if email was sent
      console.warn('[sendPasswordReset] no user for email', email);
      res.status(200).json({success: true});
      return;
    }

    const uid = userRecord.uid;

    // Generate a secure random token (hex) and store it as the doc ID
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');

    const db = admin.firestore();
    const expiresAt = admin.firestore.Timestamp.fromMillis(
      Date.now() + 1000 * 60 * 60, // 1 hour
    );

    await db.collection('password_resets').doc(token).set({
      uid,
      email,
      token,
      used: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt,
    });

    // Build the reset link — use redirectUrl from client (e.g. deep link) or fall back to resetPassword function URL
    const resetLink = redirectUrl
      ? `${redirectUrl.replace(/\/$/, '')}?token=${token}`
      : `https://us-central1-keetchen-c8e65.cloudfunctions.net/resetPassword?token=${token}`;

    // Send email via MailerSend HTTP API
    const apiKey = MAILERSEND_API_KEY.value();
    const emailPayload = JSON.stringify({
      from: {email: 'noreply@keetchen.app', name: 'Keetchen'},
      to: [{email}],
      subject: 'Reset your Keetchen password',
      text: `Reset your password by visiting: ${resetLink}\n\nThis link expires in 1 hour.`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">
          <h2 style="color:#E07B39">Reset your password</h2>
          <p>We received a request to reset your Keetchen password. Click the button below to choose a new password (expires in 1 hour):</p>
          <p style="text-align:center;margin:32px 0">
            <a href="${resetLink}"
               style="background:#E07B39;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold">
              Reset Password
            </a>
          </p>
          <p style="font-size:12px;color:#888">If you didn't request a password reset, you can safely ignore this email.</p>
        </div>`,
    });

    await new Promise<void>((resolve, reject) => {
      const https = require('https');
      const options = {
        hostname: 'api.mailersend.com',
        path: '/v1/email',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(emailPayload),
        },
      };
      const httpReq = https.request(options, (httpRes: any) => {
        let body = '';
        httpRes.on('data', (chunk: any) => { body += chunk; });
        httpRes.on('end', () => {
          if (httpRes.statusCode >= 200 && httpRes.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`MailerSend error ${httpRes.statusCode}: ${body}`));
          }
        });
      });
      httpReq.on('error', reject);
      httpReq.write(emailPayload);
      httpReq.end();
    });

    console.log('[sendPasswordReset] password reset email sent to', email);

    // Always return success so callers can't enumerate accounts
    res.status(200).json({success: true});
  } catch (err: any) {
    console.error('[sendPasswordReset] error', err);
    res.status(500).json({error: err?.message || 'Internal error'});
  }
});

// GET  /resetPassword?token=...  → serves an HTML form to enter a new password
// POST /resetPassword { token, newPassword } → validates token and updates password
export const resetPassword = functions.https.onRequest(async (req: any, res: any) => {
  const htmlPage = (title: string, emoji: string, heading: string, body: string, color: string) => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      <title>${title}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
               background: #f5f5f5; display: flex; align-items: center;
               justify-content: center; min-height: 100vh; padding: 20px; }
        .card { background: white; border-radius: 16px; padding: 40px 32px;
                max-width: 420px; width: 100%; text-align: center;
                box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
        .emoji { font-size: 64px; margin-bottom: 20px; }
        h1 { color: ${color}; font-size: 24px; margin-bottom: 12px; }
        p { color: #666; font-size: 16px; line-height: 1.5; }
        .hint { margin-top: 24px; font-size: 14px; color: #999; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="emoji">${emoji}</div>
        <h1>${heading}</h1>
        <p>${body}</p>
        <p class="hint">You can close this page and return to the Keetchen app.</p>
      </div>
    </body>
    </html>`;

  // ── GET: serve the password-entry form ──────────────────────────────────
  if (req.method === 'GET') {
    const token = (req.query.token as string || '').trim();
    if (!token) {
      res.status(400).send(htmlPage('Error', '❌', 'Invalid Link', 'This reset link is missing a token.', '#e53935'));
      return;
    }

    // Quick validity check before showing form
    try {
      const docSnap = await admin.firestore().collection('password_resets').doc(token).get();
      if (!docSnap.exists) {
        res.status(400).send(htmlPage('Error', '❌', 'Invalid Link', 'This reset link is invalid or has already been used.', '#e53935'));
        return;
      }
      const data: any = docSnap.data();
      if (data.used) {
        res.send(htmlPage('Already Used', '✅', 'Link Already Used', 'This password reset link has already been used. Please request a new one from the app.', '#43a047'));
        return;
      }
      if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
        res.status(400).send(htmlPage('Link Expired', '⏰', 'Link Expired', 'This reset link has expired. Please open the Keetchen app and request a new one.', '#fb8c00'));
        return;
      }
    } catch (e) {
      res.status(500).send(htmlPage('Error', '❌', 'Something went wrong', 'Please try again or request a new reset link.', '#e53935'));
      return;
    }

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>Reset Password – Keetchen</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                 background: #f5f5f5; display: flex; align-items: center;
                 justify-content: center; min-height: 100vh; padding: 20px; }
          .card { background: white; border-radius: 16px; padding: 40px 32px;
                  max-width: 420px; width: 100%;
                  box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
          h1 { color: #E07B39; font-size: 24px; margin-bottom: 8px; text-align: center; }
          p.sub { color: #888; font-size: 14px; text-align: center; margin-bottom: 28px; }
          label { display: block; font-size: 14px; font-weight: 600; color: #444; margin-bottom: 6px; }
          input[type=password] {
            width: 100%; padding: 12px 14px; border: 1.5px solid #ddd;
            border-radius: 8px; font-size: 16px; outline: none;
            transition: border-color .2s;
          }
          input[type=password]:focus { border-color: #E07B39; }
          .gap { margin-bottom: 16px; }
          button {
            width: 100%; padding: 14px; background: #E07B39; color: white;
            border: none; border-radius: 8px; font-size: 16px; font-weight: bold;
            cursor: pointer; margin-top: 8px; transition: opacity .2s;
          }
          button:disabled { opacity: .6; cursor: not-allowed; }
          #msg { margin-top: 16px; font-size: 14px; text-align: center; }
          .err { color: #e53935; } .ok { color: #43a047; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🔑 Reset Password</h1>
          <p class="sub">Enter your new Keetchen password below.</p>
          <form id="form">
            <div class="gap">
              <label for="pw">New password</label>
              <input type="password" id="pw" placeholder="At least 6 characters" required minlength="6"/>
            </div>
            <div class="gap">
              <label for="pw2">Confirm new password</label>
              <input type="password" id="pw2" placeholder="Repeat password" required minlength="6"/>
            </div>
            <button type="submit" id="btn">Reset Password</button>
            <div id="msg"></div>
          </form>
        </div>
        <script>
          document.getElementById('form').addEventListener('submit', async function(e) {
            e.preventDefault();
            const pw = document.getElementById('pw').value;
            const pw2 = document.getElementById('pw2').value;
            const msg = document.getElementById('msg');
            const btn = document.getElementById('btn');
            if (pw !== pw2) { msg.className = 'err'; msg.textContent = 'Passwords do not match.'; return; }
            btn.disabled = true;
            btn.textContent = 'Resetting…';
            msg.textContent = '';
            try {
              const r = await fetch(window.location.pathname, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({token: '${token}', newPassword: pw}),
              });
              const data = await r.json();
              if (data.success) {
                msg.className = 'ok';
                msg.textContent = '✅ Password updated! You can now log in with your new password.';
                document.getElementById('form').innerHTML = '<p style="text-align:center;color:#43a047;font-size:16px">🎉 Password reset successfully!<br/>Return to the Keetchen app and log in.</p>';
              } else {
                msg.className = 'err';
                msg.textContent = data.error || 'Something went wrong. Please try again.';
                btn.disabled = false; btn.textContent = 'Reset Password';
              }
            } catch(err) {
              msg.className = 'err';
              msg.textContent = 'Network error. Please try again.';
              btn.disabled = false; btn.textContent = 'Reset Password';
            }
          });
        </script>
      </body>
      </html>`);
    return;
  }

  // ── POST: consume token and update password ──────────────────────────────
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  try {
    const {token, newPassword} = req.body || {};
    if (!token || !newPassword) {
      res.status(400).json({error: 'Missing token or newPassword'});
      return;
    }

    const db = admin.firestore();
    const docRef = db.collection('password_resets').doc(token);
    const snap = await docRef.get();
    if (!snap.exists) {
      res.status(400).json({error: 'Invalid or expired token'});
      return;
    }

    const data: any = snap.data();
    if (data.used) {
      res.status(400).json({error: 'Token already used'});
      return;
    }
    const expiresAt = data.expiresAt as admin.firestore.Timestamp;
    if (expiresAt && expiresAt.toMillis() < Date.now()) {
      res.status(400).json({error: 'Token expired'});
      return;
    }

    const uid = data.uid;
    await admin.auth().updateUser(uid, {password: newPassword});
    await admin.auth().revokeRefreshTokens(uid);
    await docRef.update({used: true, usedAt: admin.firestore.FieldValue.serverTimestamp()});

    res.status(200).json({success: true});
  } catch (err: any) {
    console.error('[resetPassword] error', err);
    res.status(500).json({error: err?.message || 'Internal error'});
  }
});
