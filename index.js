const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;

const stripe = require("stripe")(process.env.STRIPE_PAY);

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rgrxfrw.mongodb.net/?appName=Cluster0`;

let admin = require("firebase-admin");

let serviceAccount = require("./shifto-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middleware

app.use(express.json());
app.use(cors());

const verifyFbToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorize access" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;

    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorize access" });
  }
};

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// generate traciking id function from AI

const crypto = require("crypto");
const { Transform } = require("stream");
const { runInNewContext } = require("vm");
const { networkInterfaces } = require("os");
const { asyncWrapProviders } = require("async_hooks");

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

    // admin middleware

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    const db = client.db("shifTo_db");
    const parcelsCollection = db.collection("parcels");
    const paymentsCollection = db.collection("payments");
    const usersCollection = db.collection("users");
    const ridersCollection = db.collection("riders");
    const trackingsCollection = db.collection("trackings");

    const trackingsLog = async (trackingId, status) => {
      const log = {
        trackingId: trackingId,
        status: status,
        details: status.split("-").join(" "),
        createdAt: new Date(),
      };
      const result = await trackingsCollection.insertOne(log);
      return result;
    };

    // all users api

    app.get("/users", verifyFbToken, async (req, res) => {
      const searchText = req.query.searchText;
      const query = {};
      if (searchText) {
        // query.displayName = {$regex: searchText, $options: 'i'}

        query.$or = [
          { displayName: { $regex: searchText, $options: "i" } },
          { email: { $regex: searchText, $options: "i" } },
        ];
      }

      const cursor = usersCollection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(5);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      res.send({ role: result?.role || "user" });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const email = user.email;
      const userExist = await usersCollection.findOne({ email });
      if (userExist) {
        return res.result({ message: "user already existed" });
      }
      user.role = "user";
      user.createdAt = new Date().toISOString();
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.patch("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updateInfo = req.body;

      const result = await usersCollection.updateOne(query, {
        $set: {
          ...updateInfo,
          updatedAt: new Date(), // ✅ add update time
        },
      });
      res.send(result);
    });

    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });

    // rider api

    // riders related apis
    app.get("/riders", verifyFbToken, async (req, res) => {
      const query = {};
      if (req.query.status) {
        query.status = req.query.status;
      }
      if (req.query.workStatus) {
        query.workStatus = req.query.workStatus;
      }
      if (req.query.district) {
        query.district = req.query.district;
      }

      const cursor = ridersCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/riders", async (req, res) => {
      const rider = req.body;
      rider.status = "pending";
      rider.createdAt = new Date();

      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    });

    app.patch("/riders/:id", verifyFbToken, verifyAdmin, async (req, res) => {
      try {
        const status = req.body.status;
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        // const updateFields = {
        //   status: status,
        //   statusUpdatedAt: new Date(),
        // };
        let updateFields = {
          status: status,
          statusUpdatedAt: new Date(),
        };

        if (status === "approved") {
          updateFields.workStatus = "available";
        }

        let updateDoc = {
          $set: updateFields,
        };

        if (status === "rejected") {
          updateDoc.$unset = { workStatus: "" };
        }

        const result = await ridersCollection.updateOne(query, updateDoc);

        // const result = await ridersCollection.updateOne(query, {
        //   $set: updateFields,
        // });

        let userResult = null; // ✅ FIX

        if (status === "approved") {
          const email = req.body.email;
          const userQuery = { email };
          const updateUser = {
            $set: { role: "rider" },
          };

          userResult = await usersCollection.updateOne(userQuery, updateUser);
        }

        res.send({ result, userResult });
      } catch (error) {
        console.error("PATCH /riders error:", error); // ✅ DEBUG LOG
        res
          .status(500)
          .send({ message: "Internal server error", error: error.message });
      }
    });

    app.delete("/riders/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await ridersCollection.deleteOne(query);
      res.send(result);
    });

    // all parcels api

    app.get("/parcels", async (req, res) => {
      const query = {};
      // const {email} = req.query
      const email = req.query.email;
      const deliveryStatus = req.query.deliveryStatus;
      if (email) {
        query.senderEmail = email;
      }
      if (deliveryStatus) {
        query.deliveryStatus = deliveryStatus;
      }
      const options = { sort: { createdAt: -1 } };
      const result = await parcelsCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/parcels/rider", async (req, res) => {
      const { riderEmail, deliveryStatus } = req.query;
      const query = {};

      if (riderEmail) {
        query.riderEmail = riderEmail;
      }
      // if (deliveryStatus ) {
      //     query.deliveryStatus = {$in: ['rider-assigned', 'rider-arriving']}

      // }

      if (deliveryStatus !== "parcel-delivered") {
        // query.deliveryStatus = {$in: ['driver_assigned', 'rider_arriving']}
        query.deliveryStatus = { $nin: ["parcel-delivered"] };
      } else {
        query.deliveryStatus = deliveryStatus;
      }

      const cursor = parcelsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // status patch
    app.patch("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const { riderId, riderName, riderEmail, trackingId } = req.body;

      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          riderId: riderId,
          riderName: riderName,
          riderEmail: riderEmail,
          deliveryStatus: "rider-assigned",
        },
      };

      const result = await parcelsCollection.updateOne(query, updateDoc);

      trackingsLog(trackingId, "rider-assigned");

      // update rider information
      const riderQuery = { _id: new ObjectId(riderId) };
      const riderUpdatedDoc = {
        $set: {
          workStatus: "in-transit",
        },
      };
      const riderResult = await ridersCollection.updateOne(
        riderQuery,
        riderUpdatedDoc,
      );

      res.send(riderResult);
    });

    // deliver status for rider last part

    app.patch("/parcels/:id/rider", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const { deliveryStatus, riderId, trackingId } = req.body;
      const updatedDoc = {
        $set: {
          deliveryStatus: deliveryStatus,
        },
      };

      if (deliveryStatus === "parcel_delivered") {
        // update rider information
        const riderQuery = { _id: new ObjectId(riderId) };
        const riderUpdatedDoc = {
          $set: {
            workStatus: "available",
          },
        };
        const riderResult = await ridersCollection.updateOne(
          riderQuery,
          riderUpdatedDoc,
        );
      }

      trackingsLog(trackingId, deliveryStatus);

      const result = await parcelsCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.post("/parcels", async (req, res) => {
      const parcels = req.body;
      parcels.createdAt = new Date().toISOString();
      parcels.paymentStatus = "Unpaid";
      const result = await parcelsCollection.insertOne(parcels);
      res.send(result);
    });

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollection.deleteOne(query);
      res.send(result);
    });

    // payment related apis

    app.post("/create-checkout-session", async (req, res) => {
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
                currency: "usd", // Change to 'bdt' if you want Taka
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
          mode: "payment",
          success_url: `${process.env.YOUR_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.YOUR_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const transactionId = session.payment_intent;

      const query = { transactionId: transactionId };
      const paymentExist = await paymentsCollection.findOne(query);
      if (paymentExist) {
        return res.send({
          message: "already paid",
          trackingId: paymentExist.trackingId,
          transactionId: paymentExist.transactionId,
        });
      }

      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        // const transactionId = session.payment_intent
        const trackingId = generateTrackingId();
        const update = {
          $set: {
            paymentStatus: "paid",
            transactionId: transactionId,
            trackingId: trackingId,
            deliveryStatus: "pending-pickup",
          },
        };
        const result = await parcelsCollection.updateOne(query, update);

        trackingsLog(trackingId, "parcel_paid");

        const payment = {
          parcelName: session.metadata.parcelName,
          parcelId: session.metadata.parcelId,
          senderEmail: session.customer_email,
          transactionId: transactionId,
          trackingId: trackingId,
          paymentStatus: session.payment_status,
          cost: session.amount_total / 100,
          currency: session.currency,
          paidAt: new Date(),
        };

        const resultPayment = await paymentsCollection.insertOne(payment);

        res.send({
          result,
          transactionId: transactionId,
          trackingId: trackingId,

          paymentInfo: resultPayment,
        });
      }

      res.send({ success: false });
    });

    app.get("/payments", verifyFbToken, async (req, res) => {
      const email = req.query.email;
      const query = {};

      if (email) {
        query.senderEmail = email;
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "forbidden access" });
        }
      }
      const result = await paymentsCollection.find(query).toArray();
      res.send(result);
    });

    // tracking related api

    app.get("/tracking/:trackingId/logs", async (req, res) => {
      const trackingId = req.params.trackingId;
      const query = { trackingId };
      const result = await trackingsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello ShifTo!");
});

app.listen(port, () => {
  console.log(`Shifto listening on port ${port}`);
});
