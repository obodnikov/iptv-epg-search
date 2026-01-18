/**
 * ratingControl.js - Star Rating UI Component
 * Creates and manages 5-star rating controls
 */

import { getRating, setRating, removeRating, getProgramId } from '../utils/ratings.js';

/**
 * Create a star rating control element
 * @param {Object} program - Program object
 * @param {Function} onRatingChange - Callback when rating changes (optional)
 * @returns {HTMLElement} - Rating control element
 */
export function createRatingControl(program, onRatingChange = null) {
  const programId = getProgramId(program);
  const currentRating = getRating(programId);
  
  const container = document.createElement('div');
  container.className = 'rating-control';
  container.dataset.programId = programId;
  
  // Create 5 stars
  for (let i = 1; i <= 5; i++) {
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'rating-star';
    star.dataset.rating = i;
    star.setAttribute('aria-label', `Rate ${i} star${i > 1 ? 's' : ''}`);
    
    // Set filled state
    if (currentRating && i <= currentRating) {
      star.classList.add('filled');
    }
    
    // Star icon (using HTML entity for better compatibility)
    star.innerHTML = '&#9733;'; // ★ (filled star)
    
    // Click handler
    star.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent triggering parent click events
      handleStarClick(container, program, i, onRatingChange);
    });
    
    // Hover effect
    star.addEventListener('mouseenter', () => {
      highlightStars(container, i);
    });
    
    container.appendChild(star);
  }
  
  // Reset hover on mouse leave
  container.addEventListener('mouseleave', () => {
    const rating = getRating(programId);
    highlightStars(container, rating || 0);
  });
  
  return container;
}

/**
 * Handle star click
 * @param {HTMLElement} container - Rating control container
 * @param {Object} program - Program object
 * @param {number} rating - Selected rating (1-5)
 * @param {Function} callback - Optional callback
 */
function handleStarClick(container, program, rating, callback) {
  const programId = getProgramId(program);
  const currentRating = getRating(programId);
  
  // Explicit check for null/undefined - treat both as "no rating"
  const hasRating = currentRating !== null && currentRating !== undefined;
  
  // If clicking the same rating, remove it
  if (hasRating && currentRating === rating) {
    removeRating(programId);
    updateRatingDisplay(container, null);
    
    if (callback) {
      callback(null, program);
    }
  } else {
    // Set new rating
    setRating(programId, rating);
    updateRatingDisplay(container, rating);
    
    if (callback) {
      callback(rating, program);
    }
  }
}

/**
 * Highlight stars up to a certain rating
 * @param {HTMLElement} container - Rating control container
 * @param {number} rating - Rating to highlight (0-5)
 */
function highlightStars(container, rating) {
  const stars = container.querySelectorAll('.rating-star');
  stars.forEach((star, index) => {
    if (index < rating) {
      star.classList.add('filled');
    } else {
      star.classList.remove('filled');
    }
  });
}

/**
 * Update rating display
 * @param {HTMLElement} container - Rating control element
 * @param {number|null} rating - New rating value
 */
export function updateRatingDisplay(container, rating) {
  highlightStars(container, rating || 0);
}

/**
 * Create a compact rating display (read-only)
 * @param {number|null} rating - Rating value (1-5 or null)
 * @returns {HTMLElement} - Rating display element
 */
export function createRatingDisplay(rating) {
  const container = document.createElement('div');
  container.className = 'rating-display';
  
  if (!rating) {
    container.innerHTML = '<span class="rating-none">Not rated</span>';
    return container;
  }
  
  // Create filled and empty stars
  for (let i = 1; i <= 5; i++) {
    const star = document.createElement('span');
    star.className = 'rating-star-display';
    star.innerHTML = i <= rating ? '&#9733;' : '&#9734;'; // ★ or ☆
    container.appendChild(star);
  }
  
  return container;
}

/**
 * Get rating control from program card
 * @param {HTMLElement} card - Program card element
 * @returns {HTMLElement|null} - Rating control element
 */
export function getRatingControlFromCard(card) {
  return card.querySelector('.rating-control');
}

/**
 * Refresh rating control display
 * @param {HTMLElement} control - Rating control element
 * @param {Object} program - Program object
 */
export function refreshRatingControl(control, program) {
  const programId = getProgramId(program);
  const rating = getRating(programId);
  updateRatingDisplay(control, rating);
}
