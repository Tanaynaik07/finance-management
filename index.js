import {
    collection,
    doc,
    setDoc,
    addDoc,
    getDocs,
    getDoc,
} from "firebase/firestore";
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
} from "firebase/auth";
import express from "express";
import bodyParser from "body-parser";
import session from "express-session";

import { db } from "./firebase.js";

const app = express();
const port = 3000;
const auth = getAuth();

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(
    session({
        secret: "your-secret-key",
        resave: false,
        saveUninitialized: true,
    })
);

// Static Files & View Engine
app.use(express.static("public"));
app.set("view engine", "ejs");

// Routes
app.get("/", async (req, res) => {
    const user = req.session.user || null;
    if (user) {
        const { expenses, total } = await fetchExpenses(user.uid);
        res.render("index", { user, expenses, total }); // `user` contains `name`
    } else {
        res.render("index", { user: null, expenses: [] });
    }
});


// Helper Functions

// Save user data in Firestore
const saveUserData = async (uid, email,name) => {
    const userRef = doc(db, "users", uid);
    await setDoc(userRef, { email,name });
};

// Register User
app.post("/signup", async (req, res) => {
    const {name, email, password } = req.body;
    try {
        const userCredential = await createUserWithEmailAndPassword(
            auth,
            email,
            password
        );
        const { uid } = userCredential.user;
        await saveUserData(uid, email,name);
        req.session.user = { uid, email,name };
        res.redirect("/");
    } catch (error) {
        console.error("Error registering user:", error.message);
        res.send("Signup failed. Please try again.");
    }
});

// Login User
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const userCredential = await signInWithEmailAndPassword(
            auth,
            email,
            password
        );
        const { uid } = userCredential.user;

        // Fetch user data to retrieve name
        const userDoc = await getDoc(doc(db, "users", uid));
        if (userDoc.exists()) {
            const { name } = userDoc.data();
            req.session.user = { uid, email, name }; // Store `name` in session
        } else {
            console.error("No user data found");
        }
        res.redirect("/");
    } catch (error) {
        console.error("Error logging in user:", error.message);
        res.send("Login failed. Please try again.");
    }
});


// Logout User
app.post("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/");
    });
});

// Add Expense
app.post("/add-expense", async (req, res) => {
    const user = req.session.user;
    if (!user) return res.redirect("/");
    const { description, amount } = req.body;

    try {
        const expensesRef = collection(db, `users/${user.uid}/expenses`);
        await addDoc(expensesRef, { description, amount, date: new Date() });
        res.redirect("/");
    } catch (error) {
        console.error("Error adding expense:", error.message);
        res.send("Failed to add expense. Please try again.");
    }
});

// Fetch Expenses
const fetchExpenses = async (uid) => {
    const expensesRef = collection(db, `users/${uid}/expenses`);
    const querySnapshot = await getDocs(expensesRef);
    const expenses = [];
    var total=0;
    querySnapshot.forEach((doc) => {
        // ctotal += parseInt(doc.data().amount);console.log(typeof doc.data().amount, doc.data().amount); // Debugging
         // Ensure proper conversion
        // total+=doc.data().amount;
        total += parseFloat(doc.data().amount);
        // console.log(total,typeof total);
        expenses.push({ id: doc.id, ...doc.data() });
    });
    return {expenses,total};
};

// Start Server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
