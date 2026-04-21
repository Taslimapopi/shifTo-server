const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000

const stripe = require('stripe')(process.env.STRIPE_PAY)

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rgrxfrw.mongodb.net/?appName=Cluster0`;

// middleware

app.use(express.json())
app.use(cors())

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// generate traciking id function from AI

const crypto = require("crypto");
const { Transform } = require('stream');
const { runInNewContext } = require('vm');

function generateTrackingId() {
  // Generate a random string using crypto
  const randomPart = crypto.randomBytes(4).toString("hex").toUpperCase(); // 8 characters
  // Get the current timestamp
  const timestampPart = Date.now().toString(36).toUpperCase(); // Base36 timestamp
  // Combine parts to form the tracking ID
  const trackingId = `TRK-${timestampPart}-${randomPart}`;
  return trackingId;
}

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db('shifTo_db');
    const parcelsCollection = db.collection('parcels')
    const paymentsCollection = db.collection('payments')

    // all parcels api

    app.get('/parcels',async (req,res)=>{
        const query = {}
        // const {email} = req.query
        const email = req.query.email
        if(email){
            query.senderEmail = email
        }
        const options = {sort:{createdAt:-1}}
        const result = await parcelsCollection.find(query).toArray()
        res.send(result)

    })

    app.post('/parcels', async(req,res)=>{
        const parcels = req.body
        parcels.createdAt = new Date().toISOString();
        const result = await parcelsCollection.insertOne(parcels) 
        res.send(result)
    })

    app.delete('/parcels/:id', async(req,res)=>{
        const id  = req.params.id
        const query = {_id: new ObjectId(id)}
        const result = await parcelsCollection.deleteOne(query)
        res.send(result)
    })


    // payment related apis

app.post('/create-checkout-session', async (req, res) => {
    try {
        const { parcelName, parcelId, senderEmail, cost } = req.body;

        // Important: Convert cost properly and validate
        const amount = parseInt(cost);

        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).send({ error: "Invalid amount" });
        }

        const session = await stripe.checkout.sessions.create({
            line_items: [
                {
                    price_data: {
                        currency: 'usd',           // Change to 'bdt' if you want Taka
                        unit_amount: amount * 100, // Convert to cents/paisa
                        product_data: {
                            name: `Please pay for: ${parcelName}`,
                        },
                    },
                    quantity: 1,
                },
            ],
            customer_email: senderEmail,
            metadata: {
                parcelId: parcelId,
                parcelName: parcelName,
            },
            mode: 'payment',
            success_url: `${process.env.YOUR_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.YOUR_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });

    } catch (error) {
        console.error("Stripe Error:", error.message);
        res.status(500).send({ error: error.message });
    }
});

app.patch('/payment-success', async(req, res)=>{
    const sessionId = req.query.session_id
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if(session.payment_status=== 'paid'){
        const id = session.metadata.parcelId
        const query = {_id: new ObjectId(id)}
        const transactionId = session.payment_intent
        const trackingId = generateTrackingId()
        const update = {
            $set: {
                paymentStatus : 'paid',
                transactionId : transactionId,
                trackingId: trackingId,
            }
        }
        const result = await parcelsCollection.updateOne(query,update)
        
        const payment = {
        parcelName: session.metadata.parcelName,
        parcelId: session.metadata.parcelId,
        senderEmail: session.customer_email,
        transactionId: transactionId,
        trackingId: trackingId,
        paymentStatus: session.payment_status,
        cost: session.amount_total/100,
        paidAt: new Date()
    }

    const resultPayment = await paymentsCollection.insertOne(payment)

    res.send({result, transactionId: transactionId,
        trackingId:trackingId,
        
        paymentInfo:resultPayment})

    }

    
    res.send({ success: false })
    console.log(session)
})
    




// Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Hello ShifTo!')
})

app.listen(port, () => {
  console.log(`Shifto listening on port ${port}`)
})
