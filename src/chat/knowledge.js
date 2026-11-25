/**
 * Verified ERP Instructions by Workflow and Required Permissions.
 * Store verified instructions so workflow updates are easy to review and maintain.
 */

const ERP_WORKFLOW_KNOWLEDGE = [
  {
    id: 'employees_management',
    module: 'employees',
    title: 'Employee Profiles & Staff Records',
    screenLabel: 'Employees',
    requiredPermissions: ['employees.read'],
    steps: [
      'Navigate to the "Employees" screen from the navigation menu.',
      'To add a new employee (requires employees.create): click the "Add Employee" button.',
      'Fill in Full Name, Phone (Pakistani format 03XX-XXXXXXX), CNIC (35201-XXXXXXX-X), Department, and Designation.',
      'Select Employment Status: Active, Inactive, or Terminated.',
      'Click "Save" to register the employee profile.',
      'To update an employee (requires employees.update): click the Edit icon on the employee table row.',
    ],
  },
  {
    id: 'users_management',
    module: 'users',
    title: 'System Users & Login Accounts',
    screenLabel: 'Users',
    requiredPermissions: ['users.read'],
    steps: [
      'Navigate to the "Users" screen.',
      'To create a new user (requires users.create): click "Create User".',
      'Optionally link the user to an existing Employee profile from the dropdown.',
      'Enter Username, Email Address, and set an initial Password (minimum 8 characters).',
      'Select a Role (e.g. Sales, Accounts, Super Admin) to establish user permissions.',
      'Toggle Account Active status and click "Save User".',
      'To edit user details or deactivate access (requires users.update): click Edit on the user row.',
    ],
  },
  {
    id: 'roles_permissions',
    module: 'roles',
    title: 'Roles & Permission Matrix',
    screenLabel: 'Roles / Permissions',
    requiredPermissions: ['roles.read'],
    steps: [
      'Navigate to the "Roles" screen.',
      'To create a role (requires roles.create): click "Add Role" and enter the Role Name and Description.',
      'In the Permission Matrix, check the appropriate module actions (e.g. create, read, update, delete).',
      'Click "Save Role" to persist permission assignments.',
      'Users assigned this role will immediately inherit these module access rights.',
    ],
  },
  {
    id: 'suppliers_management',
    module: 'suppliers',
    title: 'LPG Suppliers Management',
    screenLabel: 'Suppliers',
    requiredPermissions: ['suppliers.read'],
    steps: [
      'Navigate to the "Suppliers" screen.',
      'To add a new supplier (requires suppliers.create): click "Add Supplier".',
      'Enter Supplier Name, Contact Person, Phone, Email, Address, and Opening Balance.',
      'Click "Save Supplier" to register the supplier.',
      'The supplier will now be available in LPG Receipts and Supplier Payments.',
    ],
  },
  {
    id: 'storage_tanks',
    module: 'storage-tanks',
    title: 'Storage Tanks & LPG Level Monitoring',
    screenLabel: 'Storage Tanks',
    requiredPermissions: ['storage-tanks.read'],
    steps: [
      'Navigate to the "Storage Tanks" screen.',
      'View list of tanks, tank capacity in KG, current gas stock level (KG), and percentage full.',
      'To add a new tank (requires storage-tanks.create): click "Add Tank", enter Tank Name/Code, Maximum Capacity (KG), and Location.',
      'Tank stock is automatically updated when LPG Receipts are recorded (stock in) or Filling Batches are run (stock out).',
    ],
  },
  {
    id: 'lpg_receipts',
    module: 'lpg-receipts',
    title: 'LPG Receipts (Gas Inward / Intake)',
    screenLabel: 'LPG Receipts',
    requiredPermissions: ['lpg-receipts.read'],
    steps: [
      'Navigate to the "LPG Receipts" screen.',
      'To record incoming gas (requires lpg-receipts.create): click "New LPG Receipt".',
      'Select the Supplier and the destination Storage Tank.',
      'Enter Received Quantity in KG, Rate per KG, Bowser / Vehicle Number, and Supplier Invoice Number.',
      'Confirm the transaction. The destination Storage Tank stock increases by the received KG, and accounts payable to the supplier is updated.',
    ],
  },
  {
    id: 'filling_batches',
    module: 'filling-batches',
    title: 'Cylinder Refilling Batches (Plant Production)',
    screenLabel: 'Filling Batches',
    requiredPermissions: ['filling-batches.read'],
    steps: [
      'Navigate to the "Filling Batches" screen.',
      'To record a new refilling run (requires filling-batches.create): click "Create Batch".',
      'Select the source Storage Tank and the Cylinder Type (e.g. 11.8 KG, 15 KG, 35 KG, 45.4 KG).',
      'Enter the Quantity of cylinders to fill.',
      'The system calculates total LPG required (Cylinders * Capacity KG) and checks available tank stock.',
      'Confirm the batch: empty cylinder stock decreases, filled cylinder inventory increases, and tank LPG stock decreases.',
    ],
  },
  {
    id: 'cylinder_types',
    module: 'cylinder-types',
    title: 'Cylinder Types & Specifications',
    screenLabel: 'Cylinder Types',
    requiredPermissions: ['cylinder-types.read'],
    steps: [
      'Navigate to the "Cylinder Types" screen.',
      'Review existing specifications: 11.8 KG (Domestic), 15 KG (Domestic), 35 KG (Commercial), 45.4 KG (Commercial).',
      'To add or edit (requires cylinder-types.create / update): specify Type Code, Name, Tare Weight (KG), Category, and Default Selling Price.',
    ],
  },
  {
    id: 'inventory_items',
    module: 'inventory-items',
    title: 'Cylinder Inventory (Empty & Filled)',
    screenLabel: 'Inventory Items',
    requiredPermissions: ['inventory-items.read'],
    steps: [
      'Navigate to the "Inventory Items" screen.',
      'Monitor on-hand inventory for each cylinder category: Empty Cylinders vs Filled Cylinders.',
      'Check current stock levels against Minimum Stock Levels for replenishment alerts.',
      'Inventory movements automatically synchronize with Sales, Sales Returns, and Filling Batches.',
    ],
  },
  {
    id: 'customers_management',
    module: 'customers',
    title: 'Customers Directory & Credit Profiles',
    screenLabel: 'Customers',
    requiredPermissions: ['customers.read'],
    steps: [
      'Navigate to the "Customers" screen.',
      'To register a new customer (requires customers.create): click "Add Customer".',
      'Enter Customer Name, Phone Number, CNIC/NTN, Address, Opening Balance, and Credit Limit.',
      'Click "Save Customer".',
      'Customers are selected when creating Sales Invoices or receiving Customer Payments.',
    ],
  },
  {
    id: 'sales_invoices',
    module: 'sales',
    title: 'Sales Invoices & Billing',
    screenLabel: 'Sales',
    requiredPermissions: ['sales.read'],
    steps: [
      'Navigate to the "Sales" screen.',
      'To create a sale (requires sales.create): click "New Sale".',
      'Select Customer and choose Sale Type: "Cash" or "Credit".',
      'Add items: select Filled Cylinder Type or LPG bulk, enter Quantity and Rate per unit/KG.',
      'Review Subtotal, any Discount, and Total Payable Amount.',
      'If Cash sale: select the receiving Account (Cash / Bank) and enter Paid Amount.',
      'Click "Confirm & Generate Invoice". Filled cylinder inventory is automatically decremented.',
    ],
  },
  {
    id: 'customer_payments',
    module: 'payments',
    title: 'Customer Payments & Receivable Collections',
    screenLabel: 'Payments',
    requiredPermissions: ['payments.read'],
    steps: [
      'Navigate to the "Payments" screen.',
      'To record a customer payment (requires payments.create): click "Receive Payment".',
      'Select Customer and the related Sales Invoice (or general ledger credit).',
      'Enter Received Amount, Payment Method (Cash / Bank / Cheque / Online), and receiving Account.',
      'Click "Save Payment". The invoice payment status updates (Paid / Partial) and customer receivable balance is reduced.',
    ],
  },
  {
    id: 'sales_returns',
    module: 'sales-returns',
    title: 'Sale Returns & Cylinder Exchanges',
    screenLabel: 'Sales Returns',
    requiredPermissions: ['sales-returns.read'],
    steps: [
      'Navigate to the "Sales Returns" screen.',
      'To record a return (requires sales-returns.create): click "Create Sale Return".',
      'Select the original Sale Invoice and the customer.',
      'Select the returned items, Return Quantity, and Return Reason (e.g. Defective Valve, Transit Damage, Customer Request).',
      'Submit the return. The original sale updates status to "Partially Returned" or "Returned", cylinder stock is adjusted, and customer balance is credited.',
    ],
  },
  {
    id: 'customer_refunds',
    module: 'payments',
    title: 'Customer Refund Payments',
    screenLabel: 'Payments',
    requiredPermissions: ['payments.read'],
    steps: [
      'Navigate to the "Payments" screen.',
      'To issue a refund (requires payments.create): click "Customer Refund".',
      'Select Customer and the return or credit balance to refund.',
      'Enter Refund Amount and disbursing Account (Cash on Hand / Bank).',
      'Confirm the transaction to clear customer refund dues.',
    ],
  },
  {
    id: 'supplier_payments',
    module: 'payments',
    title: 'Supplier Payments & Payables Settlement',
    screenLabel: 'Payments',
    requiredPermissions: ['payments.read'],
    steps: [
      'Navigate to the "Payments" screen.',
      'To make a supplier payment (requires payments.create): click "Make Payment".',
      'Select Supplier and the unpaid LPG Receipt or payable balance.',
      'Enter Paid Amount, Payment Method (Cash / Bank Transfer / Cheque), and paying Account.',
      'Click "Submit Payment". Supplier outstanding payable balance is decreased accordingly.',
    ],
  },
  {
    id: 'accounts_chart',
    module: 'accounts',
    title: 'Chart of Accounts & Ledger Balances',
    screenLabel: 'Accounts',
    requiredPermissions: ['accounts.read'],
    steps: [
      'Navigate to the "Accounts" screen.',
      'View ledger accounts: Cash on Hand, Bank Accounts, Accounts Receivable, Accounts Payable, Sales Income, Expenses.',
      'To add an account (requires accounts.create): click "Add Account", enter Account Code, Name, Account Type, and Opening Balance.',
      'Track real-time balances and transaction history for each account.',
    ],
  },
  {
    id: 'expenses_management',
    module: 'expenses',
    title: 'Plant Expenses & Expense Categories',
    screenLabel: 'Expenses',
    requiredPermissions: ['expenses.read'],
    steps: [
      'Navigate to the "Expenses" screen.',
      'To log an expense (requires expenses.create): click "Record Expense".',
      'Select Expense Category (e.g. Utilities, Fuel, Plant Maintenance, Staff Salaries).',
      'Select payment Account (Cash / Bank), enter Amount, Date, and Expense Description / Voucher #.',
      'Click "Save Expense". Ledger balances update immediately.',
    ],
  },
  {
    id: 'assets_maintenance',
    module: 'assets',
    title: 'Plant Assets & Maintenance Logging',
    screenLabel: 'Assets / Maintenance Records',
    requiredPermissions: ['assets.read'],
    steps: [
      'Navigate to the "Assets" or "Maintenance Records" screen.',
      'Track plant machinery: Compressors, Dispensers, Generators, Decanting units, Delivery vehicles.',
      'To log servicing (requires maintenance-records.create): click "Add Maintenance Record", select Asset, enter Service Date, Cost, Technician/Vendor, and Work Done.',
    ],
  },
  {
    id: 'dashboard_overview',
    module: 'dashboard',
    title: 'Executive Dashboard & Plant Overview',
    screenLabel: 'Dashboard',
    requiredPermissions: ['reports.read'],
    steps: [
      'Navigate to the "Dashboard" screen.',
      'View real-time key metrics: Total LPG Stock (KG), Storage Tank fill percentages, Filled vs Empty Cylinders count, Today\'s Sales, Receivables, and Payables.',
      'Use quick summary cards to monitor operations before taking daily decisions.',
    ],
  },
  {
    id: 'system_settings_audit',
    module: 'settings',
    title: 'System Settings & Audit Logs',
    screenLabel: 'Settings / Audit Logs',
    requiredPermissions: ['settings.read'],
    steps: [
      'Navigate to "Settings" to view or modify company name, currency (PKR), default unit (KG), and profit margins.',
      'Navigate to "Audit Logs" (requires audit-logs.read) to inspect historical system actions, timestamps, and user activity records.',
    ],
  },
];

/**
 * Filter knowledge base workflows allowed for a given set of permission codes.
 * If user has super admin / all permissions, all workflows are returned.
 *
 * @param {string[]} userPermissions - Array of permission codes the user currently holds.
 * @returns {Array} List of workflow objects the user is permitted to view.
 */
function getWorkflowsForPermissions(userPermissions = []) {
  const permSet = new Set(userPermissions);

  return ERP_WORKFLOW_KNOWLEDGE.filter((wf) => {
    // If no required permissions specified, public to all authenticated users
    if (!wf.requiredPermissions || wf.requiredPermissions.length === 0) {
      return true;
    }
    // Check if user has ANY of the required read/create permissions for this workflow
    return wf.requiredPermissions.some((perm) => permSet.has(perm));
  });
}

/**
 * Formats allowed workflow entries into concise, readable instructions for the AI model context.
 *
 * @param {Array} allowedWorkflows - Filtered workflows
 * @returns {string} Formatted context
 */
function formatKnowledgeForPrompt(allowedWorkflows = []) {
  if (!allowedWorkflows || allowedWorkflows.length === 0) {
    return 'No ERP workflow guides are accessible under the current user permissions.';
  }

  return allowedWorkflows
    .map((wf) => {
      const stepLines = wf.steps.map((step, idx) => `  ${idx + 1}. ${step}`).join('\n');
      return `### Workflow: ${wf.title}\nExact Screen: "${wf.screenLabel}"\nSteps:\n${stepLines}`;
    })
    .join('\n\n');
}

module.exports = {
  ERP_WORKFLOW_KNOWLEDGE,
  getWorkflowsForPermissions,
  formatKnowledgeForPrompt,
};
