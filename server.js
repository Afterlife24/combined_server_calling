// ---------- Imports ----------
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

// ---------- Configurations ----------
const app = express();
app.use(express.json());
app.use(cors());

// ---------- Hardcoded MongoDB Connection ----------
const MONGO_URI =
  "mongodb+srv://financials:financials@financials.6f1amos.mongodb.net/?retryWrites=true&w=majority&appName=Financials";
const PORT = 5000;

let client;
let dbConnections = {}; // cache per database

async function connectDB() {
  try {
    client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    console.log("✅ MongoDB connected successfully");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
}

function getDB(restaurantName) {
  // Map frontend selection to specific database names
  let dbName;
  if (restaurantName.toLowerCase() === "bhawarchi") {
    dbName = "bhawarchi";
  } else {
    dbName = "Bansari_Restaurant"; // default
  }

  if (!dbConnections[dbName]) {
    dbConnections[dbName] = client.db(dbName);
  }
  return dbConnections[dbName];
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
    const { ordersCollection } = getCollections(restaurant);
    const orders = await ordersCollection.find({}, { projection: { _id: 0 } }).toArray();
    res.json(orders);
  } catch (error) {
    console.error("❌ Error fetching orders:", error);
    res.status(500).json({ error: "Failed to fetch orders" });
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

    res.json({
      restaurant,
      total_orders: totalOrders,
      confirmed_orders: confirmedOrders,
      delivered_orders: deliveredOrders,
      revenue,
    });
  } catch (error) {
    console.error("❌ Error fetching stats:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
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

// ---------- Start Server ----------
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
