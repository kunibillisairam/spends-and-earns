import { connectToDatabase } from '../_lib/mongodb';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = "super_secret_key_123";

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const { phone, password } = req.body;

    try {
        const { db } = await connectToDatabase();
        
        const user = await db.collection('users').findOne({ phone });
        if (!user) {
            return res.status(400).json({ message: 'User not found' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid password' });
        }

        // Create Token
        const token = jwt.sign({ userId: user._id, phone: user.phone }, JWT_SECRET, { expiresIn: '7d' });

        res.status(200).json({ 
            message: 'Login successful', 
            token,
            user: { username: user.username, phone: user.phone }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}
