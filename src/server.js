require('dotenv').config();

const path = require('path');
const express = require('express');
const certificateRoutes = require('./routes/certificates');
const paymentRequestRoutes = require('./routes/paymentRequests');
const pushNotificationRoutes = require('./routes/pushNotifications');
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const servicesRoutes = require('./routes/services');
const adminRoutes = require('./routes/admin');
const { requireAuth } = require('./middleware/auth');

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/certificates', requireAuth, certificateRoutes);
app.use('/api/payment-requests', requireAuth, paymentRequestRoutes);
app.use('/api/profile', requireAuth, profileRoutes);
app.use('/api/services', requireAuth, servicesRoutes);
app.use('/api/push', requireAuth, pushNotificationRoutes);

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API endpoint not found' });
});

app.get('*', (_request, response) => {
  response.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(error.statusCode || 500).json({
    error: error.publicMessage || 'Internal server error'
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Certificates app is running on port ${port}`);
});
