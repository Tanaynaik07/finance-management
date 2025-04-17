from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import NoAlertPresentException
from selenium.webdriver.support.ui import Select
import time
import json
import os
import unittest
import datetime

class TestReport:
    def __init__(self):
        self.start_time = datetime.datetime.now()
        self.test_cases = []
        self.total_tests = 0
        self.passed_tests = 0
        self.failed_tests = 0
        self.errors = []

    def add_test_case(self, name, status, error=None):
        self.total_tests += 1
        if status == "PASSED":
            self.passed_tests += 1
        else:
            self.failed_tests += 1
            if error:
                self.errors.append(f"{name}: {error}")
        
        self.test_cases.append({
            "name": name,
            "status": status,
            "error": error,
            "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })

    def generate_report(self):
        end_time = datetime.datetime.now()
        duration = end_time - self.start_time
        
        report = f"""
Test Report
===========
Date: {datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
Duration: {duration.total_seconds():.2f} seconds

Summary
-------
Total Tests: {self.total_tests}
Passed: {self.passed_tests}
Failed: {self.failed_tests}
Success Rate: {(self.passed_tests/self.total_tests*100 if self.total_tests > 0 else 0):.2f}%

Test Cases
---------
"""
        for test in self.test_cases:
            report += f"{test['timestamp']} - {test['name']}: {test['status']}\n"
            if test['error']:
                report += f"    Error: {test['error']}\n"

        if self.errors:
            report += "\nErrors\n------\n"
            for error in self.errors:
                report += f"- {error}\n"

        return report

# Get the current directory for debugging
print(f"Current working directory: {os.getcwd()}")
print(f"Script directory: {os.path.dirname(os.path.abspath(__file__))}")

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'credentials.json')) as cred:
    credentials = json.load(cred)

# Initialize test report
test_report = TestReport()

driver = webdriver.Chrome()
driver.get("http://localhost:3000/login")

for cred in credentials:
    driver.get("http://localhost:3000/login")

    loginEmail = driver.find_element(By.ID, "email")
    loginPassword = driver.find_element(By.ID, "password")

    loginEmail.send_keys(cred['email'])
    loginPassword.send_keys(cred['password'])
    loginPassword.send_keys(Keys.RETURN)
    
    time.sleep(2)  # Let alert (if any) appear

    try:
        alert = driver.switch_to.alert
        test_report.add_test_case(f"Login - {cred['email']}", "FAILED", f"Login failed - Alert: {alert.text}")
        alert.accept()
    except NoAlertPresentException:
        test_report.add_test_case(f"Login - {cred['email']}", "PASSED")
        try:
            # Test adding expense
            print("\nTesting Add Expense...")
            expenseForm = driver.find_element(By.TAG_NAME, "form")
            expenseForm.find_element(By.ID, "description").send_keys("Test Expense")
            expenseForm.find_element(By.ID, "amount").send_keys("100")
            # Select dropdowns
            Select(expenseForm.find_element(By.ID, "expenseType")).select_by_visible_text("Rent")
            Select(expenseForm.find_element(By.ID, "amountType")).select_by_visible_text("Expense (-)")
            expenseForm.find_element(By.ID, "add-expense-btn").click()
            time.sleep(2)
            test_report.add_test_case("Add Expense", "PASSED")
            
            # Test editing expense
            print("\nTesting Edit Expense...")
            editBtn = driver.find_element(By.ID, "edit-expense-btn")
            editBtn.click()
            time.sleep(2)
            
            # Wait for modal to be visible
            WebDriverWait(driver, 10).until(
                EC.visibility_of_element_located((By.ID, "editExpenseModal"))
            )
            
            editForm = driver.find_element(By.ID, "editExpenseForm")
            editForm.find_element(By.ID, "editDescription").clear()
            editForm.find_element(By.ID, "editDescription").send_keys("Updated Test Expense")
            editForm.find_element(By.ID, "editAmount").clear()
            editForm.find_element(By.ID, "editAmount").send_keys("200")
            Select(editForm.find_element(By.ID, "editExpenseType")).select_by_visible_text("Utilities")
            editForm.find_element(By.ID, "editExpenseSubmitBtn").click()
            time.sleep(2)
            test_report.add_test_case("Edit Expense", "PASSED")
            
            # Test adding reminder
            print("\nTesting Add Reminder...")
            addReminderBtn = driver.find_element(By.XPATH, "//button[text()='Add New Reminder']")
            addReminderBtn.click()
            time.sleep(2)
            
            # Wait for modal to be visible
            WebDriverWait(driver, 10).until(
                EC.visibility_of_element_located((By.ID, "addReminderModal"))
            )
            
            reminderForm = driver.find_element(By.ID, "addReminderForm")
            reminderForm.find_element(By.ID, "reminderDescription").send_keys("Test Reminder")
            reminderForm.find_element(By.ID, "reminderAmount").send_keys("500")
            reminderForm.find_element(By.ID, "reminderPeriod").send_keys("30")
            Select(reminderForm.find_element(By.ID, "reminderAmountType")).select_by_visible_text("Expense (-)")
            reminderForm.find_element(By.XPATH, "//button[text()='Add Reminder']").click()
            time.sleep(2)
            test_report.add_test_case("Add Reminder", "PASSED")
            
            # Test editing reminder
            print("\nTesting Edit Reminder...")
            editReminderBtn = driver.find_element(By.XPATH, "//button[text()='Edit']")
            editReminderBtn.click()
            time.sleep(2)
            
            # Wait for modal to be visible
            WebDriverWait(driver, 10).until(
                EC.visibility_of_element_located((By.ID, "editReminderModal"))
            )
            
            editReminderForm = driver.find_element(By.ID, "editReminderForm")
            editReminderForm.find_element(By.ID, "editReminderDescription").clear()
            editReminderForm.find_element(By.ID, "editReminderDescription").send_keys("Updated Test Reminder")
            editReminderForm.find_element(By.ID, "editReminderAmount").clear()
            editReminderForm.find_element(By.ID, "editReminderAmount").send_keys("1000")
            editReminderForm.find_element(By.ID, "editReminderPeriod").send_keys("60")
            Select(editReminderForm.find_element(By.ID, "editReminderAmountType")).select_by_visible_text("Income (+)")
            editReminderForm.find_element(By.XPATH, "//button[text()='Save Changes']").click()
            time.sleep(2)
            test_report.add_test_case("Edit Reminder", "PASSED")
            
            # Test export functionality
            print("\nTesting Export Functionality...")
            # Test Excel export
            excelExport = driver.find_element(By.XPATH, "//button[text()='Download Excel']")
            excelExport.click()
            time.sleep(2)
            test_report.add_test_case("Export Excel", "PASSED")
            
            # Test PDF export
            pdfExport = driver.find_element(By.XPATH, "//button[text()='Download PDF']")
            pdfExport.click()
            time.sleep(2)
            test_report.add_test_case("Export PDF", "PASSED")
            
            # Test deleting expense
            print("\nTesting Delete Expense...")
            deleteBtn = driver.find_element(By.XPATH, "//button[@type='submit']")
            deleteBtn.click()
            time.sleep(2)
            test_report.add_test_case("Delete Expense", "PASSED")
            
            # Test deleting reminder
            print("\nTesting Delete Reminder...")
            deleteReminderBtn = driver.find_element(By.XPATH, "//button[text()='Delete']")
            deleteReminderBtn.click()
            time.sleep(2)
            test_report.add_test_case("Delete Reminder", "PASSED")
            
            logout = driver.find_element(By.ID, "logout-btn")
            logout.click()
            time.sleep(2)
            test_report.add_test_case("Logout", "PASSED")
        except Exception as e:
            test_report.add_test_case("Test Suite", "FAILED", str(e))
            print(f"⚠️ Error during testing: {e}")

# Generate and save the test report
report_filename = f"test_report_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
with open(report_filename, "w") as f:
    f.write(test_report.generate_report())

print(f"\nTest report saved to: {report_filename}")
print(test_report.generate_report())

driver.quit()
