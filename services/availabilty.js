import AsyncStorage from '@react-native-async-storage/async-storage';

import { API_BASE_URL } from '../config';

export const getWeeklyAvailability = async (token, startDate = null) => {
    try {
        let url = `${API_BASE_URL}/availability/week`;
        if (startDate) {
            url += `?start_date=${startDate}`;
        }
        
        const response = await fetch(url, {
            headers: { 'x-auth-token': token },
        });
        
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching availability:', error);
        return { success: false, message: error.message };
    }
};

export const checkDateAvailability = async (token, date) => {
    try {
        const response = await fetch(`${API_BASE_URL}/availability/date/${date}`, {
            headers: { 'x-auth-token': token },
        });
        
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error checking date:', error);
        return { success: false, message: error.message };
    }
};