const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '.')));

let activeUsers = {};
let depositRequests = [];
let withdrawRequests = [];
let promoCodes = [];

io.on('connection', (socket) => {
    // User registration & online tracking
    socket.on('register_user', (userData) => {
        activeUsers[userData.userId] = {
            ...userData,
            lastActive: Date.now()
        };
        // Broadcast updated users list to admin
        io.emit('update_users_list', activeUsers);
    });

    // Handle user disconnect
    socket.on('disconnect', () => {
        // Optional: handle user offline status if needed
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`ZyloBet Server running on port ${PORT}`);
});
