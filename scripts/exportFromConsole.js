/**
 * Run this script in the Firebase Console browser while viewing the source_periods collection
 *
 * Instructions:
 * 1. Go to Firebase Console → Firestore Database → source_periods collection
 * 2. Open browser DevTools (F12 or Cmd+Option+I)
 * 3. Go to Console tab
 * 4. Copy and paste this entire script
 * 5. Press Enter
 * 6. The data will be downloaded as source_periods.json
 */

(async function exportSourcePeriods() {
  console.log('🔄 Starting export of source_periods...');

  // Get Firebase instance from the console page
  const firebase = window.firebase;
  if (!firebase) {
    console.error('❌ Firebase not found. Make sure you are on Firebase Console page.');
    return;
  }

  const db = firebase.firestore();

  try {
    const snapshot = await db.collection('source_periods').get();
    console.log(`📊 Found ${snapshot.size} documents`);

    const data = [];
    snapshot.forEach(doc => {
      data.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Convert to JSON
    const jsonStr = JSON.stringify(data, null, 2);

    // Create download
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'source_periods.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('✅ Downloaded source_periods.json with', data.length, 'documents');
    console.log('📁 Save this file to:', '/Users/scottwall/Desktop/Projects/FamilyFinance/FamilyFinance-CloudFunctions/');

  } catch (error) {
    console.error('❌ Error exporting:', error);
  }
})();
