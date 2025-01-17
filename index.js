import { collection, doc, setDoc, addDoc, getDocs, getDoc } from "firebase/firestore";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification,sendPasswordResetEmail } from "firebase/auth";
import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import { db } from "./firebase.js";
 import moment from "moment";
 

const app = express();
const port = 3000;
const auth = getAuth();

 

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
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
        // Calculate the total expenses in the last 30 days
        const totalLast30Days = getTotalExpensesLast30Days(expenses);
        console.log(expenses);
        res.render("index", { user, expenses, total,totalLast30Days });
    } else {
        res.render("login", { user: null, expenses: [] });
    }
});

// Helper Functions
const saveUserData = async (uid, email, name) => {
    const userRef = doc(db, "users", uid);
    await setDoc(userRef, { email, name });
};

app.get("/signup", (req, res) => {
    res.render("signup", { user: null });
});

app.get("/login", (req, res) => {
    res.render("login", { user: null });
});

// Register User
app.post("/signup", async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const { uid } = userCredential.user;

        // Send email verification
        await sendEmailVerification(userCredential.user);

        // Save user data to Firestore
        await saveUserData(uid, email, name);

        req.session.user = { uid, email, name };

        res.send("Registration successful! Please check your email to verify your account.");
    } catch (error) {
        console.error("Error registering user:", error.message);
        res.send("Signup failed. Please try again.");
    }
});

// Login User
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    var error;
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const { uid } = userCredential.user;

        // Check if the user's email is verified
        if (!userCredential.user.emailVerified) {
            error="Please z"
            res.redirect("/login");
            res.render("/login", { user: null,error });
            res.send("Please verify your email before logging in.");
            return;
        }

        // Fetch user data to retrieve name
        const userDoc = await getDoc(doc(db, "users", uid));
        if (userDoc.exists()) {
            const { name } = userDoc.data();
            req.session.user = { uid, email, name }; // Store `name` in session
        } else {
            console.error("No user data found");
        }

        res.redirect("/"); // Redirect to the main app page
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
    let { description, amount } = req.body;
    if (!description) {
        description = "No Info";
    }

    try {
        const expensesRef = collection(db, `users/${user.uid}/expenses`);
        await addDoc(expensesRef, { description, amount, date: new Date() });
        res.redirect("/");
    } catch (error) {
        console.error("Error adding expense:", error.message);
        res.send("Failed to add expense. Please try again.");
    }
});

// Render Forgot Password Page
app.get("/forgot-password", (req, res) => {
    res.render("forgot-password", { user: null });
});

// Handle Forgot Password Form Submission
app.post("/forgot-password", async (req, res) => {
    const { email } = req.body;

    try {
        await sendPasswordResetEmail(auth, email);
        res.send("Password reset email sent. Please check your inbox.");
    } catch (error) {
        console.error("Error sending password reset email:", error.message);
        res.send("Failed to send password reset email. Please try again.");
    }
});
 
 



// Fetch Expenses
const fetchExpenses = async (uid) => {
    const expensesRef = collection(db, `users/${uid}/expenses`);
    const querySnapshot = await getDocs(expensesRef);
    const expenses = [];
    let total = 0;

    querySnapshot.forEach((doc) => {
        const expenseData = doc.data();
        const expenseDate = expenseData.date.toDate(); // Convert Firebase Timestamp to JS Date

        const formattedDate = expenseDate.toLocaleDateString(); // Only the date
        const formattedTime = expenseDate.toLocaleTimeString(); // Only the time

        expenses.push({
            id: doc.id,
            description: expenseData.description,
            amount: expenseData.amount,
            date: formattedDate,
            time: formattedTime,
            timestamp: expenseDate
        });

        total += parseFloat(expenseData.amount);
    });

    expenses.sort((a, b) => b.timestamp - a.timestamp); // Sort in descending order
    return { expenses, total };
};

// Function to calculate total expenses in the last 30 days
const getTotalExpensesLast30Days = (expenses) => {
    // Get the current date and date 30 days ago
    const thirtyDaysAgo = moment().subtract(30, 'days').toDate();

    // Filter expenses for the last 30 days
    const recentExpenses = expenses.filter(expense => {
        // Assuming each expense has a 'date' property in ISO format (e.g., 'YYYY-MM-DD')
        const expenseDate = moment(expense.date).toDate();
        return expenseDate >= thirtyDaysAgo;
    });

    // Sum the filtered expenses
    const total = recentExpenses.reduce((sum, expense) => sum + expense.amount, 0);

    return total;
};

// Start Server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
