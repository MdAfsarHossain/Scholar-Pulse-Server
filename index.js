const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
// const cookieParser = require("cookie-parser");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 5000;

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.b6ov8m0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://scholarplus-c83e6.web.app",
  ],
  credentials: true,
  optionSuccessStatus: 200,
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    // Create a database
    const db = client.db("scholarshipPlus");
    const allScholarShipsCollection = db.collection("allScholarShips");
    const allApplicationsCollection = db.collection("allApplications");
    const allReviewsCollection = db.collection("allReviews");
    const usersCollection = db.collection("users");

    // JWT Generate
    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res.send({ token });
    });

    // middlewares
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // use verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "Admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // use verify admin after verifyToken
    const verifyAdminModerator = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "Admin" || user?.role === "Moderator";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // Clear token on logout
    app.get("/logout", (req, res) => {
      res
        .clearCookie("token", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          maxAge: 0,
        })
        .send({ success: true });
    });

    // ALL POST Requests
    // create-payment-intent
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const price = req.body.price;
      const priceInCent = parseFloat(price) * 100;
      if (!price || priceInCent < 1) return;
      // generate clientSecret
      const { client_secret } = await stripe.paymentIntents.create({
        amount: priceInCent,
        currency: "usd",
        // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
        automatic_payment_methods: {
          enabled: true,
        },
      });
      // send client secret as response
      res.send({ clientSecret: client_secret });
    });

    // Add a new scholarship data to the database
    app.post(
      "/add-scholarship",
      verifyToken,
      verifyAdminModerator,
      async (req, res) => {
        const newScholarship = req.body;
        const result = await allScholarShipsCollection.insertOne(
          newScholarship
        );
        res.send(result);
      }
    );

    // save or update a user in db
    app.post("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = req.body;
      // check if user exists in db
      const isExist = await usersCollection.findOne(query);
      if (isExist) {
        return res.send(isExist);
      }
      const result = await usersCollection.insertOne({
        ...user,
        role: "User",
        timestamp: Date.now(),
      });
      res.send(result);
    });

    // add Application data
    app.post("/add-application", async (req, res) => {
      const newApplication = req.body;
      const newDateChanged = new Date(newApplication.applicationDeadline);

      const result = await allApplicationsCollection.insertOne({
        ...newApplication,
        status: "Pending",
        timestamp: Date.now(),
        applicationDeadline: newDateChanged.getTime(),
      });
      res.send(result);
    });

    // Add Review to the Database
    app.post("/add-review", async (req, res) => {
      const reviewData = req?.body;
      const result = await allReviewsCollection.insertOne(reviewData);
      res.send(result);
    });

    // ALL GET Requests
    // Get all scholarships data from the database
    app.get("/top-scholarships", async (req, res) => {
      const result = await allScholarShipsCollection
        .find({})
        .sort({ applicationFees: 1, scholarshipPostedDate: -1 }) // Sort by lowest fees and most recent post
        .limit(8) // Limit to 6 scholarships
        .toArray();
      res.send(result);
    });

    // Manage all scholarships
    app.get(
      "/manage-scholarships",
      verifyToken,
      verifyAdminModerator,
      async (req, res) => {
        const result = await allScholarShipsCollection.find().toArray();
        res.send(result);
      }
    );

    // Get single scholarship data from the database
    app.get("/single-scholartship/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await allScholarShipsCollection.findOne(query);
      res.send(result);
    });

    // Get all users data from the database
    app.get("/users/:email", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = req?.query?.filter;
      let query = {};

      if (filter && filter !== "ALL") {
        query.role = filter;
      }

      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // Get Specific user data
    app.get("/user/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    // Get Specific user role
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send({ role: result?.role });
    });

    // Gell specific user applied data
    app.get("/my-applications/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const result = await allApplicationsCollection
        .find({ applicantsEmail: email })
        .toArray();
      res.send(result);
    });

    // Get All applied applications
    app.get("/all-applications", async (req, res) => {
      const { newDate } = req.query;
      const newDateChanged = new Date(newDate);
      // Calculate the start and end of the day in milliseconds
      const startOfDay = new Date(
        newDateChanged.setHours(0, 0, 0, 0)
      ).getTime();
      const endOfDay = new Date(
        newDateChanged.setHours(23, 59, 59, 999)
      ).getTime();

      if (newDate === "undefined" || !newDate) {
        const result = await allApplicationsCollection.find().toArray();
        res.send(result);
      } else {
        let query = {
          $or: [
            { timestamp: { $gte: startOfDay, $lte: endOfDay } },
            { applicationDeadline: { $gte: startOfDay, $lte: endOfDay } },
          ],
        };
        const result = await allApplicationsCollection.find(query).toArray();
        res.send(result);
      }
    });

    // Get all review
    app.get("/all-reviews", async (req, res) => {
      const result = await allReviewsCollection.find().toArray();
      res.send(result);
    });

    // Get single user review
    app.get("/review/:email", async (req, res) => {
      const email = req.params.email;
      const result = await allReviewsCollection
        .find({
          reviewrEmail: email,
        })
        .toArray();
      res.send(result);
    });

    // Get reviews base on specific scholarships
    app.get("/reviews/:id", async (req, res) => {
      const id = req.params.id;
      const result = await allReviewsCollection
        .find({ scholarshipId: id })
        .toArray();
      res.send(result);
    });

    // Get Average rating
    app.get("/average-rating/:id", async (req, res) => {
      const id = req.params.id;
      const query = { scholarshipId: id };
      const reviews = await allReviewsCollection.find(query).toArray();
      const totalRatings = reviews.reduce(
        (sum, rating) => sum + parseInt(rating.reviewRating),
        0
      );
      const totalReviews = await allReviewsCollection.countDocuments({
        scholarshipId: id,
      });
      const averageRating = totalRatings / totalReviews;
      res.send({ averageRating });
    });

    // Admin statistics
    app.get("/admin-statistics", verifyToken, verifyAdmin, async (req, res) => {
      const totalUsers = await usersCollection.countDocuments();
      const totalScholarships =
        await allScholarShipsCollection.countDocuments();
      const totalApplications =
        await allApplicationsCollection.countDocuments();
      const totalReviews = await allReviewsCollection.countDocuments();

      // Chart Data
      const allApplications = await allApplicationsCollection.find().toArray();

      const chartData = allApplications?.map((application) => {
        const day = new Date(application?.timestamp).getDate();
        const month = new Date(application?.timestamp).getMonth() + 1;

        const data = [
          `${day}/${month}`,
          parseInt(application?.applicationFees),
        ];
        return data;
      });
      chartData.unshift(["Day", "Application Fees"]);

      res.send({
        totalUsers,
        totalScholarships,
        totalApplications,
        totalReviews,
        chartData,
      });
    });

    // ALL PATCH Requests
    // Update a single user role
    app.patch("/user-role/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { newRole } = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { role: newRole },
      };
      const result = await usersCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // Update Scholarship data
    app.put(
      "/scholarship/update/:id",
      verifyToken,
      verifyAdminModerator,
      async (req, res) => {
        const id = req.params.id;
        const updatedData = req.body;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: updatedData,
        };
        const result = await allScholarShipsCollection.updateOne(
          query,
          updateDoc
        );
        res.send(result);
      }
    );

    // Update review
    app.patch("/update-review/:id", verifyToken, async (req, res) => {
      const id = req?.params?.id;
      const updatedData = req?.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { ...updatedData },
      };
      const result = await allReviewsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // Update Applicant user information
    app.patch("/applicant-info/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          ...updatedData,
          timestamp: Date.now(),
        },
      };
      const result = await allApplicationsCollection.updateOne(
        query,
        updateDoc
      );
      res.send(result);
    });

    // Update application status
    app.patch(
      "/application-status/:id",
      verifyToken,
      verifyAdminModerator,
      async (req, res) => {
        const id = req.params.id;
        const updatedStatus = req.body;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            ...updatedStatus,
            // timestamp: Date.now(),
          },
        };
        const result = await allApplicationsCollection.updateOne(
          query,
          updateDoc
        );
        res.send(result);
      }
    );

    // Update feedback
    app.patch(
      "/add-feedback/:id",
      verifyToken,
      verifyAdminModerator,
      async (req, res) => {
        const id = req.params.id;
        const { feedback } = req.body;
        const query = { _id: new ObjectId(id) };
        const options = { upsert: true };
        const updateDoc = {
          $set: {
            feedback: feedback,
            // timestamp: Date.now(),
          },
        };
        const result = await allApplicationsCollection.updateOne(
          query,
          updateDoc,
          options
        );
        res.send(result);
      }
    );

    // ALL DELETED Requests
    // Delete a user from the database
    app.delete("/user/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Welcome to the Student Scholarship Management Website!");
});

app.listen(port, () => {
  console.log(
    `Scholarship Management System Website app listening on port ${port}`
  );
});
