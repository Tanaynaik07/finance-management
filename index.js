import { collection, doc, setDoc, addDoc, getDocs, getDoc,deleteDoc } from "firebase/firestore";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification,sendPasswordResetEmail } from "firebase/auth";
import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import { db } from "./firebase.js";
 import moment from "moment";
 import { v4 as uuidv4 } from 'uuid';
 import XLSX from "xlsx";

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
    console.log(user);
    if (user) {
        const { expenses, total } = await fetchExpenses(user.uid);
        
        res.render("index", { user, expenses, total });
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
    const expenseId = uuidv4(); // Generate a unique expense ID
    try {
        const expensesRef = collection(db, `users/${user.uid}/expenses`);
        await addDoc(expensesRef, { expenseId,description, amount, date: new Date() });
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
 
app.post("/delete-expense", async (req, res) => {
    console.log(req.body); // Log the request body for debugging
    const { expenseId } = req.body; // Get the expenseId from the request
    const user = req.session.user;
    
    if (!user) return res.redirect("/");

    try {
        // Fetch the document by expenseId (not by doc.id)
        const expensesRef = collection(db, `users/${user.uid}/expenses`);
        const querySnapshot = await getDocs(expensesRef);

        let expenseToDelete = null;
        querySnapshot.forEach((doc) => {
            const expenseData = doc.data();
            if (expenseData.expenseId === expenseId) {  // Compare expenseId
                expenseToDelete = doc.ref; // Get the reference of the expense document
            }
        });

        if (expenseToDelete) {
            await deleteDoc(expenseToDelete); // Delete the document
            res.redirect("/"); // Redirect after deletion
        } else {
            res.send("Expense not found.");
        }

    } catch (error) {
        console.error("Error deleting expense:", error.message);
        res.send("Failed to delete expense. Please try again.");
    }
});

app.get('/download-records', (req, res) => {
    const user = req.session.user;  // Assuming user session is stored here
    
    if (user) {
        const { uid } = user;
        fetchExpenses(uid).then(({ expenses }) => {
            console.log('Expenses data:', expenses);  // Log expenses data
            const expensesData = expenses.map(expense => ({
                Description: expense.description,
                Amount: expense.amount,
                Date: expense.date,
                Time: expense.time,
            }));
            downloadExcel(expensesData, res);
        }).catch(err => {
            console.error('Error fetching expenses:', err);
            res.status(500).send('Error fetching expenses.');
        });
    } else {
        res.status(401).send('User not authenticated');
    }
});


 

// Fetch Expenses with Improved Logic
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

        // Parse amount and calculate total balance
        const amount = parseFloat(expenseData.amount);
        total += amount;

        // Push formatted expense with styling flags, including expenseId
        expenses.push({
            expenseId: expenseData.expenseId, // Include expenseId
            description: expenseData.description,
            amount: amount.toFixed(2), // Keep two decimal places
            isPositive: amount > 0,
            date: formattedDate,
            time: formattedTime,
            timestamp: expenseDate
        });
    });

    // Sort expenses by date in descending order
    expenses.sort((a, b) => b.timestamp - a.timestamp);

    return { expenses, total: total.toFixed(2) }; // Keep total with two decimal places
};

const downloadExcel = (expenses, res) => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(expenses);
    XLSX.utils.book_append_sheet(wb, ws, 'Expenses');

    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    
    console.log('Generated Excel Buffer:', excelBuffer);  // Log the buffer

    res.setHeader('Content-Disposition', 'attachment; filename=expenses_data.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(excelBuffer);
};

 
// Start Server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
