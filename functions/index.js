const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp(functions.config().firebase);

const firestore = admin.firestore();
const settings = { timestampInSnapshots: true };
firestore.settings(settings);

const stripe = require('stripe')(functions.config().stripe.token);

exports.addStripeSource = functions.firestore.document('cards/{userId}/tokens/{tokenId}')
    .onCreate(async (tokenSnap, context) => {
        var customer;
        const data = tokenSnap.data();
        if (data === null) {
            return null
        }
        const token = data.tokenId;
        const snapshot = await firestore.collection('users').doc(context.params.userId).get();
        const customerId = snapshot.data().custId; // No custID in firestore Min 18:30
        const customerEmail = snapshot.data().email;
        if (customerId === 'new') {

            customer = await stripe.customers.create({
                email: customerEmail,
                source: token
            });
            firestore.collection('users').doc(context.params.userId).update({
                custId: customer.id
            });
            // customer = await stripe.customers.createSource(
            //     customer.id,
            //     {
            //         source: token
            //     });

        }
        else {
            customer = await stripe.customers.retrieve(customerId);
            // customer.sources.create({
            //     card: token
            // });
            console.log("Already exists!");
        }

        const source = customer.sources.data[0];
        console.log(source);
        return await firestore.collection('cards').doc(context.params.userId)
            .collection('sources').doc(source.card.fingerprint).set(source);
    })

// exports.chargeUser = functions.firestore.document('newtransaction')
//     .onCreate(async (tokenSnap, context) => {
//         var customer;
//         const data = tokenSnap.data();
//         if (data === null) {
//             return null
//         }
//         const token = data.tokenId;
//         const snapshot = await firestore.collection('users').doc(context.params.userId).get();
//         const customerId = snapshot.data().custId; // No custID in firestore Min 18:30
//         const customerEmail = snapshot.data().email;
//         if (customerId === 'new') {
//             customer = await stripe.customers.create({
//                 email: customerEmail,
//                 source: token
//             });
//             firestore.collection('users').doc(context.params.userId).update({
//                 custId: customer.id
//             });
//         }

//         else {
//             customer = await stripe.customers.retrieve(customerId);
//             stripe.customers.createSource(customer.id, {
//                 source: token,
//             });
//         }

//         const customerSources = customer.sources.data;
//         return customerSources.forEach(function (source) {
//             console.log(source);
//             firestore.collection('cards').doc(context.params.userId)
//                 .collection('sources').doc(customerSource.card.fingerprint).set(source, { merge: true });
//         });
//     })