import { collection, doc, setDoc, addDoc, getDocs, getDoc, deleteDoc, arrayUnion, updateDoc, query, where, writeBatch } from "firebase/firestore";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail } from "firebase/auth";
import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import { db } from "./firebase.js";
import moment from "moment";
import { v4 as uuidv4 } from 'uuid';
import XLSX from "xlsx";
import e from "express";

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
        await updateMissingExpenseType(user.uid); // Run the update function
        var { expenses, total } = await fetchExpenses(user.uid);
        // console.log(expenses);

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
            error = "Please z"
            res.redirect("/login");
            res.render("/login", { user: null, error });
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
    // console.log(req.body);
    let { description, amount, expenseType, amountType } = req.body;
    if (description === " " || description === "") {
        description = "No Info";
    }
    if (amountType === "negative") {
        amount = -Math.abs(amount);
    }
    else if (amountType === "positive") {
        amount = Math.abs(amount);
    }
    const expenseId = uuidv4(); // Generate a unique expense ID
    try {
        const expensesRef = collection(db, `users/${user.uid}/expenses`);
        await addDoc(expensesRef, { expenseId, description, amount, date: new Date(), expenseType });
        // console.log(type);
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

app.get('/download-records', (req, res) => {
    const user = req.session.user;  // Assuming user session is stored here

    if (user) {
        const { uid } = user;
        fetchExpenses(uid).then(({ expenses }) => {
            // console.log('Expenses data:', expenses);  // Log expenses data
            const expensesData = expenses.map(expense => ({
                Description: expense.description,
                Amount: expense.amount,
                Date: expense.date,
                Time: expense.time,
                Type: expense.expenseType
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
    // console.log(req.body); // Log the request body for debugging
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






app.post('/edit-expense', async (req, res) => {
    const { uid, expenseId, description, amountType, amount, expenseType } = req.body;

    console.log(req.body);  // Log the request body for debugging
    if (!uid || !expenseId || !description || !amount || !expenseType) {
        return res.status(400).send({ message: 'Missing required fields' });
    }

    try {
        // Get reference to the expenses collection
        const expensesRef = collection(db, `users/${uid}/expenses`);

        // Create a query to find the document that matches the expenseId
        const q = query(expensesRef, where("expenseId", "==", expenseId));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            return res.status(404).send({ message: 'Expense not found!' });
        }

        // Get the document ID from the query result
        const docId = querySnapshot.docs[0].id;
        console.log("Document ID:", docId);

        // Create a reference to the specific expense document
        const expenseDocRef = doc(db, `users/${uid}/expenses`, docId);

        // Fetch the expense document
        const expenseDoc = await getDoc(expenseDocRef);

        if (!expenseDoc.exists()) {
            return res.status(404).send({ message: 'Expense not found!' });
        }

        // Get current data
        const expenseData = expenseDoc.data();
        const updateDates = expenseData.updateDates || [];  // Default to empty array if not present
        const editHistory = expenseData.editHistory || [];  // Default to empty array if not present

        // Add the current timestamp to the updateDates array
        const currentTimestamp = new Date();
        if (amountType === "negative") {
            amount = -Math.abs(amount);
        }
        else if (amountType === "positive") {
            amount = Math.abs(amount);
        }

        // Create an entry for the edit history
        const editEntry = {
            timestamp: currentTimestamp,
            updatedFields: {
                description: { old: expenseData.description, new: description },
                amount: { old: expenseData.amount, new: parseFloat(amount) },
                expenseType: { old: expenseData.expenseType, new: expenseType }
            },
        };

        // Add the edit entry to the edit history and updateDates
        await updateDoc(expenseDocRef, {
            description,
            amount: parseFloat(amount),
            expenseType,
            updateDates: arrayUnion(currentTimestamp),  // Firebase arrayUnion to ensure uniqueness
            editHistory: arrayUnion(editEntry)  // Save the edit history
        });
         
        res.redirect('/');  // Redirect to the main page after updating the expense
    } catch (error) {
        console.error('Error updating expense:', error);
        return res.status(500).send({ message: 'Server error while updating expense.' });
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
        console.log(expenseData);
        const expenseDate = expenseData.date.toDate(); // Convert Firebase Timestamp to JS Date

        const formattedDate = expenseDate.toLocaleDateString(); // Only the date
        const formattedTime = expenseDate.toLocaleTimeString(); // Only the time

        // Parse amount and calculate total balance
        const amount = parseFloat(expenseData.amount);
        total += amount;

        if (expenseData.expenseType === undefined || expenseData.expenseType === null) {
            expenseData.expenseType = "miscellaneous";
        }
        // Push formatted expense with styling flags, including expenseId
        expenses.push({
            expenseId: expenseData.expenseId, // Include expenseId
            description: expenseData.description,
            amount: amount.toFixed(2), // Keep two decimal places
            isPositive: amount > 0,
            date: formattedDate,
            time: formattedTime,
            timestamp: expenseDate,
            expenseType: expenseData.expenseType
        });
        // console.log(expenses)
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

// Update expenses with missing expenseType field to "miscellaneous"
const updateMissingExpenseType = async (uid) => {
    const expensesRef = collection(db, `users/${uid}/expenses`);
    const querySnapshot = await getDocs(expensesRef);
    const batch = writeBatch(db);  // Firestore batch update

    querySnapshot.forEach((doc) => {
        const expenseData = doc.data();

        // Check if 'expenseType' is missing or undefined
        if (!expenseData.expenseType) {
            // Add the update to the batch
            const docRef = doc.ref;
            batch.update(docRef, { expenseType: "miscellaneous" });
            console.log(`Updated expenseId: ${doc.id}, setting expenseType to 'miscellaneous'`);
        }
    });

    // Commit the batch update
    await batch.commit();
    console.log('Batch update completed for missing expenseType.');
};

// Start Server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
