const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
//const logging = require('@google-cloud/logging')();
const stripe = require('stripe')(functions.config().stripe.token);
const currency = functions.config().stripe.currency || 'USD';

// [START chargecustomer]
// Charge the Stripe customer whenever an amount is created in Cloud Firestore
exports.createStripeCharge = functions.firestore.document('stripe_customers/{userId}/charges/{id}').onCreate(async (snap, context) => {
    const val = snap.data();
    try {
        // Look up the Stripe customer id written in createStripeCustomer
        const snapshot = await admin.firestore().collection(`stripe_customers`).doc(context.params.userId).get()
        const snapval = snapshot.data();
        const customer = snapval.customer_id
        const destination_id = val.destination_id
        // Create a charge using the pushId as the idempotency key
        // protecting against double charges
        const amount = val.amount;
        const idempotencyKey = context.params.id;
        const charge = { amount, currency, customer };
        if (val.source !== null) {
            charge.source = val.source;
        }
        const response = await stripe.charges.create(charge, {
            idempotency_key: idempotencyKey, transfer_data: {
                amount: charge.amount * 0.9,
                destination: destination_id,
            },
        });
        // If the result is successful, write it back to the database
        return snap.ref.set(response, { merge: true });
    } catch (error) {
        // We want to capture errors and render them in a user-friendly way, while
        // still logging an exception with StackDriver
        console.log(error);
        await snap.ref.set({ error: userFacingMessage(error) }, { merge: true });
        return null;
        //return reportError(error, { user: context.params.userId });
    }
});
// [END chargecustomer]]

// When a user is created, register them with Stripe
exports.createStripeCustomer = functions.auth.user().onCreate(async (user) => {
    const customer = await stripe.customers.create({ email: user.email });
    return admin.firestore().collection('stripe_customers').doc(user.uid).set({ customer_id: customer.id });
});

exports.setDefaultPaymentMethod = functions.firestore.document('/stripe_customers/{userId}').onUpdate(async (change, context) => {
    const updatedPm = change.after.data().invoice_settings.default_payment_method;
    const previousPm = change.before.data().invoice_settings.default_payment_method;
    if (updatedPm !== previousPm) {
        try {
            const customer = await getCustomer(context);
            await setDefaultPaymentMethod(customer, updatedPm, context);
        } catch (error) {
            return handleFirebaseCallbackError(change.after, error);
        }
    }
});

// Add a payment source (card) for a user by writing a stripe payment source token to Cloud Firestore
exports.addPaymentSource = functions.firestore.document('/stripe_customers/{userId}/cards/{pushId}').onCreate(async (snap, context) => {
    const payment_method = snap.data();
    const token = payment_method.id;
    if (payment_method === null) {
        return null;
    }

    try {
        const customer = await getCustomer(context);
        const paymentAttachResponse = await stripe.paymentMethods.attach(token, {
            customer: customer
        });
        const paymentMethodId = paymentAttachResponse.id;
        console.log(paymentAttachResponse);
        await setDefaultPaymentMethod(customer, paymentMethodId, context);
    } catch (error) {
        return await handleFirebaseCallbackError(snap, error);
    }
});

exports.deletePaymentMethod = functions.https.onCall(async (data, context) => {
    const paymentMethodId = data.pm_id;
    try {
        const response = await stripe.paymentMethods.detach(paymentMethodId);
        console.log(response);
        await admin.firestore().collection('stripe_customers').doc(context.params.userId).collection('cards').doc(pm_id).delete();
    } catch (error) {
        console.error(error);
    }
});

// When a user deletes their account, clean up after them
exports.cleanupUser = functions.auth.user().onDelete(async (user) => {
    const snapshot = await admin.firestore().collection('stripe_customers').doc(user.uid).get();
    const customer = snapshot.data();
    await stripe.customers.del(customer.customer_id);
    return admin.firestore().collection('stripe_customers').doc(user.uid).delete();
});

async function handleFirebaseCallbackError(snap, error) {
    await snap.ref.set({ 'error': userFacingMessage(error) }, { merge: true });
    console.error(error);
    return null;
}

async function getCustomer(context) {
    const snapshot = await admin.firestore().collection('stripe_customers').doc(context.params.userId).get();
    const customer = snapshot.data().customer_id;
    return customer;
}

async function setDefaultPaymentMethod(customer, paymentMethodId, context) {
    const response = await stripe.customers.update(customer, {
        invoice_settings: {
            default_payment_method: paymentMethodId,
        }
    });
    console.log(response);
    return admin.firestore().collection('stripe_customers').doc(context.params.userId).update(response, { merge: true });
}

// To keep on top of errors, we should raise a verbose error report with Stackdriver rather
// than simply relying on console.error. This will calculate users affected + send you email
// alerts, if you've opted into receiving them.
// [START reporterror]
// function reportError(err, context = {}) {
//     // This is the name of the StackDriver log stream that will receive the log
//     // entry. This name can be any valid log stream name, but must contain "err"
//     // in order for the error to be picked up by StackDriver Error Reporting.
//     //   const logName = 'errors';

//     // https://cloud.google.com/logging/docs/api/ref_v2beta1/rest/v2beta1/MonitoredResource
//     const metadata = {
//         resource: {
//             type: 'cloud_function',
//             labels: { function_name: process.env.FUNCTION_NAME },
//         },
//     };

//     // https://cloud.google.com/error-reporting/reference/rest/v1beta1/ErrorEvent
//     const errorEvent = {
//         message: err.stack,
//         serviceContext: {
//             service: process.env.FUNCTION_NAME,
//             resourceType: 'cloud_function',
//         },
//         context: context,
//     };

//     // Write the error log entry
//     return new Promise((resolve, reject) => {
//         log.write(log.entry(metadata, errorEvent), (error) => {
//             if (error) {
//                 return reject(error);
//             }
//             return resolve();
//         });
//     });
// }
// [END reporterror]

// Sanitize the error message for the user
function userFacingMessage(error) {
    return error.type ? error.message : 'An error occurred, developers have been alerted';
}