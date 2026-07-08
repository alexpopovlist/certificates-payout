require('dotenv').config();

const path = require('path');
const express = require('express');
const certificateRoutes = require('./routes/certificates');
const paymentRequestRoutes = require('./routes/paymentRequests');

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.use('/api/certificates', certificateRoutes);
app.use('/api/payment-requests', paymentRequestRoutes);

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

app.listen(port, () => {
  console.log(`Certificates app is running on http://localhost:${port}`);
});
