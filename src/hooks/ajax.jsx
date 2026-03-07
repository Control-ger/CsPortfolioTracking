export function getData() {
  return fetch("http://localhost/cs-api/getPortfolioData.php")
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((json) => {
      return json;
    });
}
