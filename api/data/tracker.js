import { connectToDatabase } from '../_lib/mongodb';
import jwt from 'jsonwebtoken';

const JWT_SECRET = "super_secret_key_123";

export default async function handler(req, res) {
    const { token } = req.headers;
    if (!token) return res.status(401).json({ message: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { db } = await connectToDatabase();
        const userId = decoded.userId;

        if (req.method === 'GET') {
            const data = await db.collection('tracker_data').findOne({ userId });
            return res.status(200).json(data || { trackerData: [], weeklyBudget: 0 });
        }

        if (req.method === 'POST') {
            const { trackerData, weeklyBudget } = req.body;
            await db.collection('tracker_data').updateOne(
                { userId },
                { $set: { userId, trackerData, weeklyBudget, updatedAt: new Date() } },
                { upsert: true }
            );
            return res.status(200).json({ message: 'Data saved successfully' });
        }

        res.status(405).json({ message: 'Method not allowed' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}
