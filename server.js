// ---------- Imports ----------
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

// ---------- Configurations ----------
const app = express();
app.use(express.json());
app.use(cors());

// ---------- MongoDB Connections for Two Different Clusters ----------
const BHAWARCHI_MONGO_URI = "mongodb+srv://bhawarchi:bhawarchi2024@alcohal.u1bov.mongodb.net/?appName=alcohal";
const BANSARI_MONGO_URI = "mongodb+srv://financials:financials@financials.6f1amos.mongodb.net/?retryWrites=true&w=majority&appName=Financials";
const PORT = 5000;

let bhawrachiClient;
let bansariClient;
let dbConnections = {}; // cache per database

async function connectDB() {
  try {
    // Connect to Bhawarchi cluster
    bhawrachiClient = new MongoClient(BHAWARCHI_MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await bhawrachiClient.connect();
    console.log("✅ Bhawarchi MongoDB cluster connected successfully");

    // Connect to Bansari cluster
    bansariClient = new MongoClient(BANSARI_MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await bansariClient.connect();
    console.log("✅ Bansari MongoDB cluster connected successfully");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
}

function getDB(restaurantName) {
  // Map frontend selection to specific cluster and database
  let client;
  let dbName;
  
  if (restaurantName.toLowerCase() === "bhawarchi") {
    client = bhawrachiClient;
    dbName = "bhawarchi";
    console.log(`🔗 Routing to Bhawarchi cluster, database: ${dbName}`);
  } else {
    client = bansariClient;
    dbName = "Bansari_Restaurant";
    console.log(`🔗 Routing to Bansari cluster, database: ${dbName}`);
  }

  const cacheKey = `${restaurantName}_${dbName}`;
  if (!dbConnections[cacheKey]) {
    dbConnections[cacheKey] = client.db(dbName);
    console.log(`✨ Created new DB connection for ${cacheKey}`);
  }
  return dbConnections[cacheKey];
}

connectDB();

// ---------- Helper: Get Collections ----------
function getCollections(restaurant) {
  const db = getDB(restaurant);
  return {
    ordersCollection: db.collection("orders"),
    reservationsCollection: db.collection("reservations"),
  };
}

// ---------- ROUTES ----------

// ✅ Fetch all orders
app.get("/api/orders", async (req, res) => {
  try {
    const restaurant = req.query.restaurant || "bansari";
    console.log(`📦 Fetching orders for restaurant: ${restaurant}`);
    const { ordersCollection } = getCollections(restaurant);
    const orders = await ordersCollection.find({}, { projection: { _id: 0 } }).toArray();
    console.log(`📊 Found ${orders.length} orders for ${restaurant}`);
    res.json(orders);
  } catch (error) {
    console.error(`❌ Error fetching orders for ${restaurant}:`, error);
    res.status(500).json({ error: "Failed to fetch orders", details: error.message });
  }
});

// ✅ Fetch all reservations
app.get("/api/reservations", async (req, res) => {
  try {
    const restaurant = req.query.restaurant || "bansari";
    const { reservationsCollection } = getCollections(restaurant);
    const reservations = await reservationsCollection.find({}, { projection: { _id: 0 } }).toArray();
    res.json(reservations);
  } catch (error) {
    console.error("❌ Error fetching reservations:", error);
    res.status(500).json({ error: "Failed to fetch reservations" });
  }
});

// ✅ Fetch stats (total orders, confirmed, delivered, revenue)
app.get("/api/stats", async (req, res) => {
  try {
    const restaurant = req.query.restaurant || "bansari";
    console.log(`📊 Fetching stats for restaurant: ${restaurant}`);
    const { ordersCollection } = getCollections(restaurant);

    const totalOrders = await ordersCollection.countDocuments({});
    const confirmedOrders = await ordersCollection.countDocuments({ "items.status": "confirmed" });
    const deliveredOrders = await ordersCollection.countDocuments({ "items.status": "delivered" });

    const orders = await ordersCollection.find({}).toArray();
    const revenue = orders.reduce((acc, order) => {
      const orderTotal = (order.items || []).reduce((sum, item) => {
        const price = item.price || 0;
        const qty = item.quantity || 1;
        return sum + price * qty;
      }, 0);
      return acc + orderTotal;
    }, 0);

    console.log(`📈 Stats for ${restaurant}: ${totalOrders} total orders, revenue: ${revenue}`);

    res.json({
      restaurant,
      total_orders: totalOrders,
      confirmed_orders: confirmedOrders,
      delivered_orders: deliveredOrders,
      revenue,
    });
  } catch (error) {
    console.error(`❌ Error fetching stats for ${restaurant}:`, error);
    res.status(500).json({ error: "Failed to fetch stats", details: error.message });
  }
});

// ✅ Create a new order
app.post("/api/orders", async (req, res) => {
  try {
    const restaurant = req.query.restaurant || "bansari";
    const { ordersCollection } = getCollections(restaurant);

    const { phone, items, name, address, caller_phone } = req.body;
    let finalPhone = phone && phone !== "unknown" ? phone : `call_${Date.now()}`;

    const order = {
      phone: finalPhone,
      items: items || [],
      status: "confirmed",
      created_at: new Date().toISOString(),
      order_type: "phone_only",
      ...(name && { name }),
      ...(address && { address }),
      ...(caller_phone
        ? { caller_phone, phone_source: "extracted_from_call" }
        : { phone_source: "provided_by_customer" }),
    };

    await ordersCollection.insertOne(order);
    res.json({ message: "Order created successfully", order });
  } catch (error) {
    console.error("❌ Error creating order:", error);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// ✅ Get most recent order by phone
app.get("/api/orders/:phone", async (req, res) => {
  try {
    const { phone } = req.params;
    const restaurant = req.query.restaurant || "bansari";
    const { ordersCollection } = getCollections(restaurant);

    const order = await ordersCollection
      .find({ phone })
      .sort({ _id: -1 })
      .limit(1)
      .toArray();

    if (!order.length) {
      return res.status(404).json({ message: "Order not found" });
    }
    res.json(order[0]);
  } catch (error) {
    console.error("❌ Error fetching order:", error);
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

// ✅ Debug endpoint to check cluster info
app.get("/api/debug/cluster-info", async (req, res) => {
  try {
    const restaurant = req.query.restaurant || "bansari";
    const client = restaurant.toLowerCase() === "bhawarchi" ? bhawrachiClient : bansariClient;
    
    // List all databases
    const adminDb = client.db().admin();
    const dbList = await adminDb.listDatabases();
    
    // Get collections for the specific database
    const db = getDB(restaurant);
    const collections = await db.listCollections().toArray();
    
    res.json({
      restaurant,
      cluster: restaurant.toLowerCase() === "bhawarchi" ? "Bhawarchi (alcohal)" : "Bansari (financials)",
      databases: dbList.databases.map(d => d.name),
      current_database: restaurant.toLowerCase() === "bhawarchi" ? "bhawarchi" : "Bansari_Restaurant",
      collections: collections.map(c => c.name)
    });
  } catch (error) {
    console.error("❌ Error fetching cluster info:", error);
    res.status(500).json({ error: "Failed to fetch cluster info", details: error.message });
  }
});

// ---------- Start Server ----------
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
