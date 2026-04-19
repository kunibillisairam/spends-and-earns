import { connectToDatabase } from '../_lib/mongodb';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const { username, phone, password } = req.body;

    if (!username || !phone || !password) {
        return res.status(400).json({ message: 'Missing fields' });
    }

    try {
        const { db } = await connectToDatabase();
        
        // Check if user exists
        const existingUser = await db.collection('users').findOne({ phone });
        if (existingUser) {
            return res.status(400).json({ message: 'Phone number already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const result = await db.collection('users').insertOne({
            username,
            phone,
            password: hashedPassword,
            createdAt: new Date()
        });

        res.status(201).json({ message: 'User created successfully', userId: result.insertedId });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}
