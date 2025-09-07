const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken')
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_KEY)
const port = process.env.PORT || 3000;

// console.log(process.env.DB_USER,process.env.DB_PASS);
app.use(cors());
app.use(express.json());
// console.log("Stripe key is:", process.env.STRIPE_KEY);

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.t89ec.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const menuCollection = client.db("resTaurantHuntDB").collection("menu");
    const reviewCollection = client.db("resTaurantHuntDB").collection("reviews");
    const cartCollection = client.db("resTaurantHuntDB").collection("cart");
    const userCollection = client.db("resTaurantHuntDB").collection("user");
    const paymentCollection = client.db("resTaurantHuntDB").collection("payments");


    //jwt related apis
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN, {
        expiresIn: "5d"
      })
      res.send({ token })
    })
    //middleware for jwt and admin
    const verifyToken = (req, res, next) => {
      // console.log(req.headers.authorization)
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" })
      }
      const token = req.headers.authorization.split(" ")[1]
      jwt.verify(token, process.env.ACCESS_TOKEN, (error, decoded) => {
        if (error) {
          return res.status(401).send({ message: "forbidden-access" })
        }
        req.decoded = decoded;
        next(); //after decoded the authorization next() will be called 
      })
    }

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email }
      const user = await userCollection.findOne(query)
      const isAdmin = user?.role === 'admin'
      if (!isAdmin) {
        res.status(403).send({ message: "forbidden access" })
      }
      next()
    }

    //menu related apis
    app.post("/menu", verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await menuCollection.insertOne(item)
      res.send(result);
    })

    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    })


    app.get("/menu/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await menuCollection.findOne(query)
      res.send(result)
    })

    app.patch("/menu/:id", async (req, res) => {
      const item = req.body;
      // console.log(item)
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          name: item.name,
          price: item.price,
          category: item.category,
          recipe: item.recipe,
          image: item.image
        }
      }
      const result = await menuCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })
    app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await menuCollection.deleteOne(query)
      res.send(result)
    })

    //review related apis
    app.get("/reviews", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    })

    //cart related apis
    app.post("/carts", async (req, res) => {
      const cartItem = req.body;
      const result = await cartCollection.insertOne(cartItem)
      res.send(result)
    })
    app.get("/carts", async (req, res) => {
      const email = req.query.email
      const query = { email: email }
      const result = await cartCollection.find(query).toArray()
      res.send(result);
    })
    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await cartCollection.deleteOne(query)
      res.send(result)
    })


    //to get the all api collection data 
    app.get("/admin-stats",verifyToken,verifyAdmin,async(req,res)=>{
      const users = await userCollection.estimatedDocumentCount();
      const menuItems = await menuCollection.estimatedDocumentCount();
      //  const payments = await paymentCollection.find().toArray();
      //  const revenue = payments.reduce((total,payment)=>total+payment.price,0)
      
      
      //alternative way to sum all the payment price data instead of reduce method
      const revenue = await paymentCollection.aggregate([
       
        {
          $group:{ //$group is build in operator in aggregate pipeline 
            _id:null,
            totalRevenue:{$sum:'$price'}
          }
        }
      ]).toArray();

      const revenueCount = revenue.length > 0 ? revenue[0].totalRevenue : 0;

      res.send({
        users,
        menuItems,
        revenueCount
      })
    })
   
   //order-stats aggregate pipeline through lookup,unwind and group

   app.get("/order-stats",async(req,res)=>{
       const result = await paymentCollection.aggregate([
        {
          $unwind:"$menuIds"
        },
        {
           $lookup:{
            from:"menu",
            localField:"menuIds",
            foreignField:"_id",
            as:"menuItems",
           },
        }, 
        {
          $unwind:"$menuItems"
        },
        {
          $group:{
            _id:"$menuItems.category",
            quantity:{$sum:1},
            revenue:{$sum:"$menuItems.price"}
          }
          }
        ,{
          $project:{
             _id:0,
             category:"$_id",
             quantity:"$quantity",
             totalRevenue:"$revenue"
          }
        }
       ]).toArray()
       res.send(result)
   })


    //payment related apis

    app.get("/payments/:email", verifyToken, async (req, res) => {
      const query = { email: req.params.email }
      if (req.params.email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" })
      }
      const result = await paymentCollection.find(query).toArray()
      res.send(result)
    })


    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment)
      // console.log(payment)

      const query = {
        _id: {
          $in: payment.cartIds.map(id => new ObjectId(id))
        }
      }
      const deleteResult = await cartCollection.deleteMany(query)
      res.send({ paymentResult, deleteResult })
    })



    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      // console.log(amount, "amount inside the payment")
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
      })
      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })


    //user related apis
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      //  console.log(req.headers)
      const query = req.params;
      const result = await userCollection.find(query).toArray()
      res.send(result)
    })
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email }
      const existingUser = await userCollection.findOne(query)
      if (existingUser) {
        return res.send({ message: "User already exists", insertedId: null })
      }
      const result = await userCollection.insertOne(user)
      res.send(result);
    })

    //admin related api
    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" })
      }
      const query = { email: email }
      const user = await userCollection.findOne(query)
      let admin = false;
      if (user) {
        admin = user?.role === "admin"
      }
      res.send({ admin })
    })
    app.patch("/users/admin/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          role: "admin"
        }
      }
      const result = await userCollection.updateOne(query, updatedDoc)
      res.send(result)
    })

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await userCollection.deleteOne(query)
      res.send(result)
    })



    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);




app.get("/", (req, res) => {
  res.send("Welcome to Restaurant Hunt");
})

app.listen(port, () => {
  console.log(`Restaurant Hunt is running on port ${port}`);
});