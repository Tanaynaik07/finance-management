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
import nodemailer from 'nodemailer';
import cron from 'node-cron';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

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

// Email Configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// Function to check and send reminder emails
const checkAndSendReminders = async () => {
    try {
        // Get all users
        const usersSnapshot = await getDocs(collection(db, "users"));
        
        for (const userDoc of usersSnapshot.docs) {
            const userData = userDoc.data();
            const uid = userDoc.id;
            
            // Get user's reminders
            const remindersRef = collection(db, `users/${uid}/reminders`);
            const remindersSnapshot = await getDocs(remindersRef);
            
            for (const reminderDoc of remindersSnapshot.docs) {
                const reminderData = reminderDoc.data();
                const nextDue = reminderData.nextDue.toDate();
                const today = new Date();
                
                // Calculate days until due
                const daysUntilDue = Math.ceil((nextDue - today) / (1000 * 60 * 60 * 24));
                
                // If reminder is due within 5 days
                if (daysUntilDue <= 5 && daysUntilDue > 0) {
                    // Prepare email content
                    const mailOptions = {
                        from: process.env.EMAIL_USER,
                        to: userData.email,
                        subject: `Reminder: ${reminderData.description} due in ${daysUntilDue} days`,
                        html: `
                            <h2>Payment Reminder</h2>
                            <p>Hello ${userData.name},</p>
                            <p>This is a reminder that you have a payment due soon:</p>
                            <ul>
                                <li>Description: ${reminderData.description}</li>
                                <li>Amount: Rs. ${Math.abs(reminderData.amount)}</li>
                                <li>Due Date: ${nextDue.toLocaleDateString()}</li>
                                <li>Days until due: ${daysUntilDue}</li>
                            </ul>
                            <p>Please make sure to handle this payment on time.</p>
                        `
                    };
                    
                    // Send email
                    await transporter.sendMail(mailOptions);
                    console.log(`Reminder email sent to ${userData.email} for ${reminderData.description}`);
                }
            }
        }
    } catch (error) {
        console.error("Error checking and sending reminders:", error);
    }
};

// Schedule the reminder check to run daily at 9:00 AM
cron.schedule('0 9 * * *', checkAndSendReminders);

// Routes
app.get("/", async (req, res) => {
    const user = req.session.user || null;
    console.log(user);
    if (user) {
        await updateMissingExpenseType(user.uid); // Run the update function
        var { expenses, total } = await fetchExpenses(user.uid);
        const reminders = await fetchReminders(user.uid);
        // console.log(expenses);

        res.render("index", { user, expenses, total, reminders });
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
            
            // res.send("Please verify your email before logging in.");
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
        res.render("login", { user: null, error: "Login failed. Please try again." });
        // res.send("Login failed. Please try again.");
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

app.get('/download-records', async (req, res) => {
    const user = req.session.user;
    if (!user) return res.status(401).send('User not authenticated');

    try {
        // Fetch both expenses and reminders
        const { expenses } = await fetchExpenses(user.uid);
        const reminders = await fetchReminders(user.uid);

        // Prepare expenses data
        const expensesData = expenses.map(expense => ({
            Type: 'Expense',
            Description: expense.description,
            Amount: expense.amount,
            Category: expense.expenseType || 'N/A',
            Date: expense.date,
            Time: expense.time
        }));

        // Prepare reminders data
        const remindersData = reminders.map(reminder => ({
            Type: 'Reminder',
            Description: reminder.description,
            Amount: reminder.amount,
            Period: `${reminder.period} days`,
            Next_Due: reminder.nextDue,
            Category: reminder.amount > 0 ? 'Income' : 'Expense'
        }));

        // Combine and sort data
        const allData = [...expensesData, ...remindersData].sort((a, b) => {
            const dateA = a.Date ? new Date(a.Date) : new Date(a.Next_Due);
            const dateB = b.Date ? new Date(b.Date) : new Date(b.Next_Due);
            return dateB - dateA;
        });

        // Create workbook
        const wb = XLSX.utils.book_new();
        
        // Create worksheet
        const ws = XLSX.utils.json_to_sheet(allData);

        // Set column widths
        const colWidths = [
            { wch: 10 }, // Type
            { wch: 30 }, // Description
            { wch: 15 }, // Amount
            { wch: 15 }, // Category/Period
            { wch: 15 }, // Date/Next Due
            { wch: 15 }  // Time
        ];
        ws['!cols'] = colWidths;

        // Add styling
        const headerStyle = {
            font: { bold: true, color: { rgb: "FFFFFF" } },
            fill: { fgColor: { rgb: "4472C4" } },
            alignment: { horizontal: "center" }
        };

        // Apply header styling
        for (let i = 0; i < Object.keys(allData[0]).length; i++) {
            const cellRef = XLSX.utils.encode_cell({ r: 0, c: i });
            ws[cellRef].s = headerStyle;
        }

        // Add conditional formatting for amounts
        const amountCol = Object.keys(allData[0]).indexOf('Amount');
        for (let i = 1; i <= allData.length; i++) {
            const cellRef = XLSX.utils.encode_cell({ r: i, c: amountCol });
            const amount = allData[i-1].Amount;
            ws[cellRef].s = {
                font: { color: { rgb: amount >= 0 ? "008000" : "FF0000" } },
                alignment: { horizontal: "right" }
            };
        }

        // Add title
        const title = "Financial Records";
        const titleCell = XLSX.utils.encode_cell({ r: 0, c: 0 });
        ws[titleCell] = { v: title, t: 's' };
        ws[titleCell].s = {
            font: { bold: true, size: 16 },
            alignment: { horizontal: "center" }
        };

        // Add timestamp
        const timestamp = new Date().toLocaleString();
        const timestampCell = XLSX.utils.encode_cell({ r: 1, c: 0 });
        ws[timestampCell] = { v: `Generated on: ${timestamp}`, t: 's' };
        ws[timestampCell].s = {
            font: { italic: true },
            alignment: { horizontal: "center" }
        };

        // Add summary
        const totalExpenses = expenses.reduce((sum, exp) => sum + parseFloat(exp.amount), 0);
        const summaryCell = XLSX.utils.encode_cell({ r: 2, c: 0 });
        ws[summaryCell] = { v: `Net Balance: Rs. ${totalExpenses.toFixed(2)}`, t: 's' };
        ws[summaryCell].s = {
            font: { bold: true },
            alignment: { horizontal: "center" }
        };

        // Add the worksheet to the workbook
        XLSX.utils.book_append_sheet(wb, ws, 'Financial Records');

        // Generate Excel file
        const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

        // Set response headers
        res.setHeader('Content-Disposition', 'attachment; filename=financial_records.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(excelBuffer);
    } catch (error) {
        console.error('Error generating Excel file:', error);
        res.status(500).send('Error generating Excel file');
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

// Fetch Reminders
const fetchReminders = async (uid) => {
    const remindersRef = collection(db, `users/${uid}/reminders`);
    const querySnapshot = await getDocs(remindersRef);
    const reminders = [];

    querySnapshot.forEach((doc) => {
        const reminderData = doc.data();
        const nextDueDate = reminderData.nextDue.toDate();
        
        reminders.push({
            reminderId: reminderData.reminderId,
            description: reminderData.description,
            amount: reminderData.amount,
            period: reminderData.period,
            nextDue: nextDueDate.toLocaleDateString(),
            nextDueTimestamp: nextDueDate
        });
    });

    // Sort reminders by next due date
    reminders.sort((a, b) => a.nextDueTimestamp - b.nextDueTimestamp);
    return reminders;
};

// Add Reminder
app.post("/add-reminder", async (req, res) => {
    const user = req.session.user;
    if (!user) return res.redirect("/");

    const { description, amount, period, amountType } = req.body;
    const reminderId = uuidv4();
    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + parseInt(period));

    // Handle amount type
    let finalAmount = parseFloat(amount);
    if (amountType === "negative") {
        finalAmount = -Math.abs(finalAmount);
    } else if (amountType === "positive") {
        finalAmount = Math.abs(finalAmount);
    }

    try {
        const remindersRef = collection(db, `users/${user.uid}/reminders`);
        await addDoc(remindersRef, {
            reminderId,
            description,
            amount: finalAmount,
            period: parseInt(period),
            nextDue,
            createdAt: new Date()
        });

        // Check and send email immediately for testing
        const userData = (await getDoc(doc(db, "users", user.uid))).data();
        const daysUntilDue = parseInt(period);
        
        if (daysUntilDue <= 5 && daysUntilDue > 0) {
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: userData.email,
                subject: `Reminder: ${description} due in ${daysUntilDue} days`,
                html: `
                    <h2>Payment Reminder</h2>
                    <p>Hello ${userData.name},</p>
                    <p>This is a reminder that you have a payment due soon:</p>
                    <ul>
                        <li>Description: ${description}</li>
                        <li>Amount: Rs. ${Math.abs(finalAmount)}</li>
                        <li>Due Date: ${nextDue.toLocaleDateString()}</li>
                        <li>Days until due: ${daysUntilDue}</li>
                    </ul>
                    <p>Please make sure to handle this payment on time.</p>
                `
            };
            
            await transporter.sendMail(mailOptions);
            console.log(`Reminder email sent to ${userData.email} for ${description}`);
        }

        res.redirect("/");
    } catch (error) {
        console.error("Error adding reminder:", error.message);
        res.send("Failed to add reminder. Please try again.");
    }
});

// Edit Reminder
app.post("/edit-reminder", async (req, res) => {
    const user = req.session.user;
    if (!user) return res.redirect("/");

    const { reminderId, description, amount, period, amountType } = req.body;
    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + parseInt(period));

    // Handle amount type
    let finalAmount = parseFloat(amount);
    if (amountType === "negative") {
        finalAmount = -Math.abs(finalAmount);
    } else if (amountType === "positive") {
        finalAmount = Math.abs(finalAmount);
    }

    try {
        const remindersRef = collection(db, `users/${user.uid}/reminders`);
        const q = query(remindersRef, where("reminderId", "==", reminderId));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            return res.status(404).send("Reminder not found");
        }

        const docId = querySnapshot.docs[0].id;
        const reminderRef = doc(db, `users/${user.uid}/reminders`, docId);

        await updateDoc(reminderRef, {
            description,
            amount: finalAmount,
            period: parseInt(period),
            nextDue
        });

        res.redirect("/");
    } catch (error) {
        console.error("Error updating reminder:", error.message);
        res.send("Failed to update reminder. Please try again.");
    }
});

// Delete Reminder
app.post("/delete-reminder", async (req, res) => {
    const user = req.session.user;
    if (!user) return res.redirect("/");

    const { reminderId } = req.body;

    try {
        const remindersRef = collection(db, `users/${user.uid}/reminders`);
        const q = query(remindersRef, where("reminderId", "==", reminderId));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            return res.status(404).send("Reminder not found");
        }

        const docId = querySnapshot.docs[0].id;
        await deleteDoc(doc(db, `users/${user.uid}/reminders`, docId));
        res.redirect("/");
    } catch (error) {
        console.error("Error deleting reminder:", error.message);
        res.send("Failed to delete reminder. Please try again.");
    }
});

// Start Server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
