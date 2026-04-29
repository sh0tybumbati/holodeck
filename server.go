package main

import (
	"fmt"
	"net/http"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	fmt.Printf("Starting web CAD server on port %s\n", port)
	fmt.Printf("Open http://localhost:%s in your browser\n", port)

	http.Handle("/", http.FileServer(http.Dir(".")))
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		fmt.Println("Server error:", err)
	}
}