
document.addEventListener("DOMContentLoaded", function() {
    const cards = document.querySelectorAll('.tree-card');
    let index = 0;

    setInterval(() => {
        cards.forEach(c => c.classList.remove('active'));
        if (cards.length > 0) {
            cards[index].classList.add('active');
            index = (index + 1) % cards.length;
        }
    }, 2000);
});
